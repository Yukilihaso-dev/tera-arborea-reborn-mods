"""Pinned, offline UE3/GFX override builder. Never writes a client package.

The small assembler deliberately emits literal AVM1 Push values: the original
movies' constant pools and original serializer remain unchanged.
"""
from dataclasses import dataclass, field
import hashlib
import itertools
import json
import pathlib
import struct
import sys
import copy

sys.dont_write_bytecode = True
from gpk import parse_gpk, _properties

PREFIX = '__avcLobbyVideoV2_'
TOKEN = '__ArboreaVisualCleanup_LobbyVideo_v2_DDC84364_20261023'
SOURCE_DIR = 'S1Game/CookedPC/Art_Data/Packages/S1UI'
PINS = {
    'SystemOption': 'ddc84364bcadd34732f3edd703f6e1d2b332c83135ea4fed71a97e0af436b434',
    'SelectCharacter': 'ca207539deb01d8cb0938eb47958d96efddf9aacb4e7972f7df3c48ddb5bf1a2',
}


class FormatError(ValueError):
    pass


_groups = itertools.count()


def zstring(data, pos=0):
    try:
        end = data.index(0, pos)
    except ValueError as ex:
        raise FormatError('Unterminated AVM1 string') from ex
    return data[pos:end].decode('utf-8'), end + 1


@dataclass
class Action:
    code: int
    arg: bytes
    start: int
    end: int
    group: int
    children: list | None = None
    header: bytes = b''
    inline: bool = False
    branch_target: int | None = None


def parse_actions(data, base=0, fresh=False, _group=None):
    """Parse function bodies too; branch destinations retain original boundaries."""
    group = next(_groups) if _group is None else _group
    result = []
    pos = 0
    while pos < len(data):
        start = pos
        code = data[pos]
        pos += 1
        if code >= 128:
            if pos + 2 > len(data):
                raise FormatError('Truncated AVM1 action length')
            size = struct.unpack_from('<H', data, pos)[0]
            pos += 2
        else:
            size = 0
        argstart = pos
        arg = data[pos:pos+size]
        if len(arg) != size:
            raise FormatError('Truncated AVM1 action')
        pos += size
        action = Action(code, arg, base+start, base+pos, group)
        if code in (0x9b, 0x8e):
            _, q = zstring(arg)
            if q+2 > len(arg):
                raise FormatError('Truncated function argument count')
            count = struct.unpack_from('<H', arg, q)[0]
            q += 2
            if code == 0x8e:
                q += 3
            for _ in range(count):
                if code == 0x8e:
                    q += 1
                _, q = zstring(arg, q)
            if q+2 > len(arg):
                raise FormatError('Truncated function code size')
            codesize = struct.unpack_from('<H', arg, q)[0]
            action.header = arg[:q]
            q += 2
            action.inline = len(arg) > q
            if action.inline:
                body = arg[q:]
                bodybase = base+argstart+q
                if len(body) != codesize:
                    raise FormatError('Inline function body size mismatch')
            else:
                body = data[pos:pos+codesize]
                bodybase = base+pos
                pos += codesize
                if len(body) != codesize:
                    raise FormatError('External function body size mismatch')
            action.children = parse_actions(body, bodybase, _group=group)
            action.end = base+pos
        elif code in (0x99, 0x9d):
            if len(arg) != 2:
                raise FormatError('Invalid branch size')
            action.branch_target = base+pos+struct.unpack('<h', arg)[0]
        result.append(action)
    return result


def record(code, arg=b''):
    if len(arg) > 65535:
        raise FormatError('AVM1 action exceeds 16-bit length')
    return bytes([code]) + (struct.pack('<H', len(arg))+arg if code >= 128 else b'')


def write_actions(actions):
    encoded = []
    mapping = {}
    pos = 0
    for action in actions:
        if action.children is not None:
            body = write_actions(action.children)
            if len(body) > 65535:
                raise FormatError('Function exceeds 16-bit code size')
            header = action.header+struct.pack('<H', len(body))
            raw = record(action.code, header+body) if action.inline else record(action.code, header)+body
        else:
            raw = record(action.code, action.arg)
        mapping[(action.group, action.start)] = pos
        mapping[(action.group, action.end)] = pos+len(raw)
        encoded.append(raw)
        pos += len(raw)
    pos = 0
    for index, action in enumerate(actions):
        raw = encoded[index]
        if action.branch_target is not None:
            key = (action.group, action.branch_target)
            if key not in mapping:
                raise FormatError('AVM1 branch is not an instruction/block boundary')
            delta = mapping[key]-(pos+len(raw))
            if not -32768 <= delta <= 32767:
                raise FormatError('Relocated AVM1 branch exceeds signed 16-bit range')
            encoded[index] = record(action.code, struct.pack('<h', delta))
        pos += len(raw)
    return b''.join(encoded)


@dataclass
class Tag:
    kind: int
    body: bytes
    start: int
    long: bool
    children: list | None = None
    actions: list | None = None


def parse_tags(data, start, end):
    tags = []
    pos = start
    while pos < end:
        at = pos
        if pos+2 > end:
            raise FormatError('Truncated SWF tag')
        tag = struct.unpack_from('<H', data, pos)[0]
        pos += 2
        kind, size = tag >> 6, tag & 63
        long = size == 63
        if long:
            if pos+4 > end:
                raise FormatError('Truncated SWF long tag')
            size = struct.unpack_from('<I', data, pos)[0]
            pos += 4
        body = data[pos:pos+size]
        if pos+size > end:
            raise FormatError('SWF tag extends beyond container')
        item = Tag(kind, body, at, long)
        if kind == 39:
            if size < 4:
                raise FormatError('Truncated DefineSprite')
            item.children = parse_tags(data, pos+4, pos+size)
        elif kind in (12, 59):
            skip = 2 if kind == 59 else 0
            item.actions = parse_actions(body[skip:], pos+skip)
        tags.append(item)
        pos += size
        if kind == 0:
            if pos != end:
                raise FormatError('Unexpected bytes following SWF End tag')
            break
    if pos != end:
        raise FormatError('SWF tag extents do not cover container')
    return tags


def write_tags(tags):
    result = []
    for tag in tags:
        body = tag.body
        if tag.children is not None:
            body = body[:4]+write_tags(tag.children)
        elif tag.actions is not None:
            body = (body[:2] if tag.kind == 59 else b'')+write_actions(tag.actions)
        if tag.long or len(body) >= 63:
            result.append(struct.pack('<HI', (tag.kind << 6) | 63, len(body))+body)
        else:
            result.append(struct.pack('<H', (tag.kind << 6) | len(body))+body)
    return b''.join(result)


def swf_tree(raw):
    if raw[:3] != b'GFX' or raw[3] != 9 or struct.unpack_from('<I', raw, 4)[0] != len(raw):
        raise FormatError('Expected an exact uncompressed GFX v9 movie')
    nbits = raw[8] >> 3
    offset = 8+(5+nbits*4+7)//8+4
    return raw[:offset], parse_tags(raw, offset, len(raw))


def write_swf(header, tags):
    result = bytearray(header+write_tags(tags))
    struct.pack_into('<I', result, 4, len(result))
    swf_tree(result)
    return bytes(result)


def all_actions(tags):
    def walk(actions):
        for action in actions:
            yield action
            if action.children is not None:
                yield from walk(action.children)
    for tag in tags:
        if tag.actions is not None:
            yield from walk(tag.actions)
        if tag.children is not None:
            yield from all_actions(tag.children)


# Minimal AVM1 source forms. Expressions are tuples, statements are tuples too.
def lit(value): return ('lit', value)
def var(name): return ('var', name)
def reg(number): return ('reg', number)
def mem(obj, key): return ('mem', obj, lit(key) if isinstance(key, str) else key)
def call(name, *args): return ('call', name, list(args))
def method(obj, name, *args): return ('method', obj, name, list(args))
def binary(op, a, b): return ('binary', op, a, b)
def unary(op, a): return ('unary', op, a)
def fn(params, body): return ('fn', list(params), body)
def now(): return ('now',)
def obj(): return ('obj',)
def expr(value): return ('expr', value)
def local(name, value): return ('local', name, value)
def put(name, value): return ('put', name, value)
def setmem(target, key, value): return ('setmem', target, lit(key) if isinstance(key, str) else key, value)
def cond(test, yes, no=()): return ('if', test, list(yes), list(no))
def loop(test, body): return ('while', test, list(body))
def ret(value): return ('return', value)
def define(name, params, body): return ('define', name, list(params), body)
def deletemem(target, key): return ('delete', target, lit(key))

UNDEF = ('undefined',)
EQ = lambda a,b: binary(0x66, a,b)
NE = lambda a,b: unary(0x12, EQ(a,b))
AND = lambda a,b: binary(0x10,a,b)
OR = lambda a,b: binary(0x11,a,b)
ADD = lambda a,b: binary(0x47,a,b)
SUB = lambda a,b: binary(0x0b,a,b)
LT = lambda a,b: binary(0x48,a,b)
NOT = lambda a: unary(0x12,a)
NUM = lambda a: unary(0x4a,a)
TYPE = lambda a: unary(0x44,a)


def push(value):
    if value is UNDEF or value == UNDEF:
        data = b'\x03'
    elif value is None:
        data = b'\x02'
    elif isinstance(value, bool):
        data = b'\x05'+bytes([value])
    elif isinstance(value, str):
        data = b'\x00'+value.encode('utf-8')+b'\0'
    elif isinstance(value, int):
        data = b'\x07'+struct.pack('<i', value)
    else:
        raise TypeError(value)
    return record(0x96, data)


def function_bytes(name, params, body):
    if len(body) > 65535:
        raise FormatError('Generated function exceeds code-size limit')
    header = name.encode()+b'\0'+struct.pack('<H', len(params))
    header += b''.join(p.encode()+b'\0' for p in params)+struct.pack('<H', len(body))
    return record(0x9b, header)+body


class Assembler:
    def __init__(self):
        self.code = bytearray()
        self.labels = {}
        self.branches = []
        self.serial = itertools.count()

    def emit(self, raw): self.code.extend(raw)
    def label(self, name): self.labels[name] = len(self.code)
    def branch(self, code, label):
        self.branches.append((len(self.code), label))
        self.emit(record(code, b'\0\0'))

    def value(self, value):
        kind = value[0]
        if kind == 'lit': self.emit(push(value[1]))
        elif kind == 'undefined': self.emit(push(UNDEF))
        elif kind == 'var': self.emit(push(value[1])+b'\x1c')
        elif kind == 'reg': self.emit(record(0x96, b'\x04'+bytes([value[1]])))
        elif kind == 'mem':
            self.value(value[1]); self.value(value[2]); self.emit(b'\x4e')
        elif kind in ('binary', 'unary'):
            self.value(value[2])
            if kind == 'binary': self.value(value[3])
            self.emit(bytes([value[1]]))
        elif kind == 'call':
            for arg in reversed(value[2]): self.value(arg)
            self.emit(push(len(value[2]))+push(value[1])+b'\x3d')
        elif kind == 'method':
            for arg in reversed(value[3]): self.value(arg)
            self.emit(push(len(value[3]))); self.value(value[1]); self.emit(push(value[2])+b'\x52')
        elif kind == 'fn': self.emit(function_bytes('', value[1], assemble(value[2])))
        elif kind == 'obj': self.emit(push(0)+b'\x43')
        elif kind == 'now': self.emit(b'\x34')
        else: raise ValueError(kind)

    def statements(self, statements):
        for statement in statements:
            kind = statement[0]
            if kind == 'expr': self.value(statement[1]); self.emit(b'\x17')
            elif kind in ('local', 'put'):
                self.emit(push(statement[1])); self.value(statement[2]); self.emit(b'\x3c' if kind == 'local' else b'\x1d')
            elif kind == 'setmem':
                self.value(statement[1]); self.value(statement[2]); self.value(statement[3]); self.emit(b'\x4f')
            elif kind == 'return': self.value(statement[1]); self.emit(b'\x3e')
            elif kind == 'delete':
                self.value(statement[1]); self.value(statement[2]); self.emit(b'\x3a\x17')
            elif kind == 'define': self.emit(function_bytes(statement[1], statement[2], assemble(statement[3])))
            elif kind == 'if':
                ident = next(self.serial); other=f'else{ident}'; end=f'endif{ident}'
                self.value(NOT(statement[1])); self.branch(0x9d, other)
                self.statements(statement[2]); self.branch(0x99, end)
                self.label(other); self.statements(statement[3]); self.label(end)
            elif kind == 'while':
                ident=next(self.serial); start=f'loop{ident}'; end=f'endloop{ident}'
                self.label(start); self.value(NOT(statement[1])); self.branch(0x9d, end)
                self.statements(statement[2]); self.branch(0x99, start); self.label(end)
            else: raise ValueError(kind)

    def finish(self):
        for at, label in self.branches:
            delta=self.labels[label]-(at+5)
            if not -32768 <= delta <= 32767:
                raise FormatError('Generated branch exceeds 16-bit range')
            struct.pack_into('<h', self.code, at+3, delta)
        return bytes(self.code)


def assemble(statements):
    a=Assembler(); a.statements(statements); return a.finish()


def globals_token(): return mem(var('_global'), TOKEN)
def v(name): return var(name)
def m(name, key): return mem(v(name), key)
def exists(value): return AND(NE(value, UNDEF), NE(value, lit(None)))
def split(value, separator): return method(value, 'split', lit(separator))
def inc(name): return put(name, ADD(v(name), lit(1)))
def invalid_if(test): return cond(test, [ret(lit(False))])


def numeric_token_body():
    # Number(whitespace) is zero in AVM1. Require a real non-whitespace token
    # before the finite check, including the ECMA whitespace Unicode codepoints.
    whitespace=NOT(binary(0x67,v('code'),lit(32)))
    for code in (160,5760,6158,8232,8233,8239,8287,12288,65279):
        whitespace=OR(whitespace,EQ(v('code'),lit(code)))
    whitespace=OR(whitespace,AND(NOT(LT(v('code'),lit(8192))),NOT(binary(0x67,v('code'),lit(8202)))))
    return [invalid_if(NE(TYPE(v('token')),lit('string'))),
        local('real',lit(False)),local('i',lit(0)),
        loop(LT(v('i'),m('token','length')),[
            local('code',method(v('token'),'charCodeAt',v('i'))),
            cond(NOT(whitespace),[put('real',lit(True))]),inc('i')]),
        invalid_if(NOT(v('real'))),local('number',NUM(v('token'))),
        ret(EQ(SUB(v('number'),v('number')),lit(0)))]



# The index identity includes ten stock legacy tags without placed controls.
# Mandatory targets come from the pinned sprite56 placements, never discovery.
OPTION_INDEX = 'SR RN FS CR CL GR SF SFS AS AF CD SD BD MD WD CE BE KD SP VL FD TS HM LL MU LS ES PE OPE TX GEL BEQ BEL CEF CED FQ WRE SL FPS CTF'.split()
LEGACY_ABSENT = frozenset('SF SFS WD CE BE VL FD TS HM SL'.split())
REQUIRED_OPTIONS = [tag for tag in OPTION_INDEX if tag not in LEGACY_ABSENT]


def validation_body():
    """Full pinned index, fixed placed-control schema and saved-value fidelity."""
    schema = [
        invalid_if(NE(TYPE(v('snapshot')),lit('string'))),
        invalid_if(NE(m('videoOptionIndex','length'),lit(len(OPTION_INDEX)))),
    ]
    for index,tag in enumerate(OPTION_INDEX):
        schema.append(invalid_if(NE(mem(v('videoOptionIndex'),lit(index)),lit(tag))))
    schema += [
        local('expected',obj()),local('known',obj()),local('targets',obj()),
        local('savedNumbers',obj()),local('required',split(lit(' '.join(REQUIRED_OPTIONS)),' ')),
        local('index',split(lit(' '.join(OPTION_INDEX)),' ')),local('i',lit(0)),
        loop(LT(v('i'),m('index','length')),[
            setmem(v('known'),mem(v('index'),v('i')),lit(True)),inc('i')]),
        local('i',lit(0)),
        loop(LT(v('i'),m('required','length')),[
            local('tag',mem(v('required'),v('i'))),
            setmem(v('expected'),v('tag'),lit(True)),
            cond(NE(v('tag'),lit('FS')),[
                local('control',mem(mem(v('container_mc'),'setUp2_mc'),ADD(v('tag'),lit('_mc')))),
                invalid_if(NOT(exists(v('control')))),
                cond(OR(EQ(v('tag'),lit('SR')),OR(EQ(v('tag'),lit('RN')),EQ(v('tag'),lit('CL')))),[
                    put('control',m('control','combo_mc')),invalid_if(NOT(exists(v('control'))))]),
                setmem(v('targets'),v('tag'),v('control'))]),inc('i')]),
    ]
    for mode in range(3):
        schema.append(invalid_if(NOT(exists(mem(mem(v('container_mc'),'setUp2_mc'),'FS'+str(mode)+'_mc')))))
    return schema + [
        local('seen',obj()),local('records',split(v('snapshot'),'\n')),local('i',lit(0)),
        loop(LT(v('i'),m('records','length')),[
            local('record',mem(v('records'),v('i'))),
            cond(NE(v('record'),lit('')),[
                local('parts',split(v('record'),':')),local('tag',mem(v('parts'),lit(0))),
                invalid_if(NE(mem(v('known'),v('tag')),lit(True))),
                cond(EQ(mem(v('expected'),v('tag')),lit(True)),[
                    invalid_if(NE(m('parts','length'),lit(2))),
                    local('value',mem(v('parts'),lit(1))),invalid_if(EQ(v('value'),lit(''))),
                    cond(EQ(v('tag'),lit('FS')),[
                        local('fsFields',split(v('value'),'\t')),local('effective',mem(v('fsFields'),lit(0))),
                        invalid_if(NOT(OR(EQ(v('effective'),lit('0')),OR(EQ(v('effective'),lit('1')),EQ(v('effective'),lit('2')))))),
                        invalid_if(NE(NUM(v('effective')),v('screenMode'))),
                        setmem(v('savedNumbers'),v('tag'),NUM(v('effective'))) ],[
                        local('control',mem(v('targets'),v('tag'))),
                        local('fields',method(mem(mem(v('lib'),'util'),'ExtString'),'split',v('value'),lit('\t'))),
                        cond(binary(0x54,v('control'),mem(mem(v('lib'),'controls'),'S_CheckBox')),[
                            local('effective',mem(v('fields'),lit(0))),
                            invalid_if(NOT(OR(EQ(v('effective'),lit('0')),EQ(v('effective'),lit('1'))))) ],[
                            cond(binary(0x54,v('control'),mem(mem(v('lib'),'controls'),'S_SimpleComboBox')),[
                                local('effective',mem(v('fields'),SUB(m('fields','length'),lit(1)))) ],[
                                invalid_if(binary(0x54,v('control'),v('TextField'))),
                                local('effective',mem(v('fields'),lit(4))) ]) ]),
                        invalid_if(NOT(call(PREFIX+'numberToken',v('effective')))),
                        setmem(v('savedNumbers'),v('tag'),NUM(v('effective'))) ]),
                    invalid_if(AND(NE(mem(v('seen'),v('tag')),UNDEF),NE(mem(v('seen'),v('tag')),v('value')))),
                    setmem(v('seen'),v('tag'),v('value')) ]) ]),inc('i')]),
        local('i',lit(0)),
        loop(LT(v('i'),m('required','length')),[
            invalid_if(EQ(mem(v('seen'),mem(v('required'),v('i'))),UNDEF)),inc('i')]),
        invalid_if(NOT(OR(EQ(v('screenMode'),lit(0)),OR(EQ(v('screenMode'),lit(1)),EQ(v('screenMode'),lit(2)))))),
        local('output',split(call('getVideoOptionResult'),'\t')),
        invalid_if(NE(m('output','length'),lit(len(REQUIRED_OPTIONS)))),
        local('emitted',obj()),local('i',lit(0)),
        loop(LT(v('i'),m('output','length')),[
            local('parts',split(mem(v('output'),v('i')),':')),
            invalid_if(NE(m('parts','length'),lit(2))),local('tag',mem(v('parts'),lit(0))),
            invalid_if(NE(mem(v('expected'),v('tag')),lit(True))),
            invalid_if(EQ(mem(v('emitted'),v('tag')),lit(True))),
            local('value',mem(v('parts'),lit(1))),
            invalid_if(NOT(call(PREFIX+'numberToken',v('value')))),
            invalid_if(NE(NUM(v('value')),mem(v('savedNumbers'),v('tag')))),
            setmem(v('emitted'),v('tag'),lit(True)),inc('i')]),
        ret(lit(True))]


def local_task_cleanup(state):
    """Delete only the dedicated child's handler; never a stock frame/tween."""
    return [
        cond(exists(mem(state,'child')),[
            deletemem(mem(state,'child'),'onEnterFrame'),
            expr(method(mem(state,'child'),'removeMovieClip')),setmem(state,'child',UNDEF)]),
        cond(exists(mem(state,'timer')),[
            expr(call('clearInterval',mem(state,'timer'))),setmem(state,'timer',UNDEF)])]


def system_helpers():
    state=v(PREFIX+'state')
    current=AND(exists(v('t')),EQ(m('t','generation'),mem(state,'generation')))
    owned=AND(current,AND(EQ(m('t','active'),lit(True)),EQ(m('t','selected'),lit(True))))
    alive=AND(owned,AND(NOT(binary(0x67,now(),m('t','deadline'))),call(PREFIX+'selected',mem(state,'generation'))))
    cancel=[local('t',globals_token()),
        cond(current,[setmem(v('t'),'active',lit(False)),setmem(v('t'),'status',lit('cancelled'))]),
        setmem(state,'stage',lit('cancelled'))]+local_task_cleanup(state)
    # Callbacks finish original stock work, then only record/arm. These local
    # frame stages are experimental; a movie frame is not a native host boundary.
    claim=[local('t',globals_token()),
        cond(NOT(AND(exists(v('t')),AND(EQ(m('t','active'),lit(True)),EQ(m('t','selected'),lit(True))))),[ret(lit(False))]),
        cond(NOT(OR(EQ(m('t','status'),lit('awaiting')),EQ(m('t','status'),lit('close')))),[ret(lit(False))]),
        cond(NE(mem(state,'generation'),m('t','generation')),[
            *local_task_cleanup(state),
            put(PREFIX+'state',obj()),
            setmem(state,'generation',m('t','generation')),setmem(state,'stage',lit('awaiting')),
            setmem(state,'shown',lit(False)),setmem(state,'loaded',lit(False)),
            setmem(state,'child',method(v('UI'),'createEmptyMovieClip',lit(PREFIX+'systemFrame'),method(v('UI'),'getNextHighestDepth'))),
            setmem(mem(state,'child'),'onEnterFrame',fn([],[expr(call(PREFIX+'frame'))])),
            setmem(state,'watch',fn([],[
                local('t',globals_token()),cond(NOT(alive),[expr(call(PREFIX+'cancel'))])])),
            setmem(state,'timer',call('setInterval',state,lit('watch'),lit(100))),
            cond(NE(mem(v('UI'),PREFIX+'wrapped'),lit(True)),[
                setmem(v('UI'),PREFIX+'wrapped',lit(True)),
                setmem(v('UI'),PREFIX+'oldUnload',mem(v('UI'),'onUnload')),
                setmem(v('UI'),PREFIX+'oldRemove',mem(v('UI'),'$beforeRemoveMovieClip')),
                setmem(v('UI'),'onUnload',fn([],[
                    expr(call(PREFIX+'cancel')),
                    cond(EQ(TYPE(mem(v('UI'),PREFIX+'oldUnload')),lit('function')),[
                        expr(method(mem(v('UI'),PREFIX+'oldUnload'),'apply',v('this'),v('arguments')))])])),
                setmem(v('UI'),'$beforeRemoveMovieClip',fn([],[
                    expr(call(PREFIX+'cancel')),
                    cond(EQ(TYPE(mem(v('UI'),PREFIX+'oldRemove')),lit('function')),[
                        expr(method(mem(v('UI'),PREFIX+'oldRemove'),'apply',v('this'),v('arguments')))])]))])]),
        ret(lit(True))]
    frame=[local('t',globals_token()),
        cond(NOT(alive),[expr(call(PREFIX+'cancel')),ret(UNDEF)]),
        cond(NOT(AND(EQ(mem(state,'shown'),lit(True)),EQ(mem(state,'loaded'),lit(True)))),[ret(UNDEF)]),
        cond(NOT(call(PREFIX+'valid',mem(state,'snapshot'))),[expr(call(PREFIX+'cancel')),ret(UNDEF)]),
        cond(EQ(mem(state,'stage'),lit('awaiting')),[
            setmem(state,'stage',lit('applying')),setmem(v('t'),'status',lit('close')),
            local('generation',mem(state,'generation')),
            setmem(state,'appliedSnapshot',mem(state,'snapshot')),
            # An inline native callback may advance movie frames reentrantly.
            # Remove our handler and hold an applying guard until the call returns.
            deletemem(mem(state,'child'),'onEnterFrame'),
            expr(call('ToGame_SystemOption_VideoOptionResult')),
            cond(NE(mem(state,'generation'),v('generation')),[ret(UNDEF)]),
            local('t',globals_token()),
            cond(NOT(alive),[expr(call(PREFIX+'cancel')),ret(UNDEF)]),
            cond(NE(mem(state,'stage'),lit('applying')),[ret(UNDEF)]),
            setmem(state,'stage',lit('close')),
            setmem(mem(state,'child'),'onEnterFrame',fn([],[expr(call(PREFIX+'frame'))])),
            ret(UNDEF)]),
        cond(EQ(mem(state,'stage'),lit('close')),[
            cond(NE(mem(state,'snapshot'),mem(state,'appliedSnapshot')),[expr(call(PREFIX+'cancel')),ret(UNDEF)]),
            setmem(state,'stage',lit('done')),setmem(v('t'),'active',lit(False)),setmem(v('t'),'status',lit('done')),
            *local_task_cleanup(state),
            expr(call('ToGame_SystemOption_CloseUI'))])]
    return assemble([
        put(PREFIX+'state',obj()),
        define(PREFIX+'numberToken',['token'],numeric_token_body()),
        define(PREFIX+'valid',['snapshot'],validation_body()),
        define(PREFIX+'selected',['generation'],[
            local('bridge',mem(mem(mem(v('g4'),'view'),'selectCharacter'),'SelectCharacterController')),
            invalid_if(NE(TYPE(m('bridge','getInstance')),lit('function'))),
            local('currentController',method(v('bridge'),'getInstance')),
            local('currentView',m('currentController','_selectCharacter')),
            invalid_if(NOT(exists(v('currentView')))),
            invalid_if(NE(mem(mem(v('currentView'),PREFIX+'state'),'generation'),v('generation'))),
            invalid_if(NE(TYPE(m('currentView','__get__targetMovieClip')),lit('function'))),
            local('currentOwner',method(v('currentView'),'__get__targetMovieClip')),
            ret(EQ(m('currentOwner','bWidgetOpen'),lit(True)))]),
        define(PREFIX+'cancel',[],cancel),
        define(PREFIX+'takeover',[],[
            # Explicit user input cancels the freshly current attempt, including
            # the interval before this movie can claim a generation. Teardown
            # keeps its stricter generation ownership check in cancel().
            local('t',globals_token()),
            cond(AND(exists(v('t')),EQ(m('t','active'),lit(True))),[
                setmem(v('t'),'active',lit(False)),setmem(v('t'),'selected',lit(False)),
                setmem(v('t'),'status',lit('manual'))]),
            expr(call(PREFIX+'cancel'))]),
        define(PREFIX+'claim',[],claim),
        define(PREFIX+'frame',[],frame),
        define(PREFIX+'data',['snapshot'],[
            cond(NOT(call(PREFIX+'claim')),[ret(UNDEF)]),
            setmem(state,'snapshot',v('snapshot')),setmem(state,'loaded',lit(True))]),
        define(PREFIX+'show',['widgetName','show'],[
            cond(NE(method(v('widgetName'),'toLowerCase'),method(v('UIname'),'toLowerCase')),[ret(UNDEF)]),
            cond(NOT(v('show')),[expr(call(PREFIX+'takeover')),ret(UNDEF)]),
            cond(NOT(call(PREFIX+'claim')),[ret(UNDEF)]),setmem(state,'shown',lit(True))])])


def controller():
    target=var('g4')
    for name in ('view','selectCharacter','SelectCharacterController'):target=mem(target,name)
    return method(target,'getInstance')


def cancel_prefix(owner=None, reset=False):
    """Call only the current view's local cancellation, with no foreign refs."""
    view=owner if owner is not None else mem(controller(),'_selectCharacter')
    statements=[cond(EQ(TYPE(mem(view,PREFIX+'cancel')),lit('function')),[
        expr(method(view,PREFIX+'cancel'))])]
    if reset:statements.append(setmem(view,PREFIX+'started',lit(False)))
    return assemble(statements)


def select_start(manual_open):
    """Constructor setup only; observed show(true) arms one owned later frame."""
    view=v(PREFIX+'view');owner=v(PREFIX+'owner');state=mem(view,PREFIX+'state')
    current=AND(exists(v('t')),EQ(m('t','generation'),mem(state,'generation')))
    alive=AND(current,AND(EQ(m('t','active'),lit(True)),AND(
        EQ(m('t','selected'),lit(True)),AND(
            EQ(mem(controller(),'_selectCharacter'),view),
            AND(EQ(mem(owner,'bWidgetOpen'),lit(True)),NOT(binary(0x67,now(),m('t','deadline'))))))))
    cancel=[local('t',globals_token()),
        cond(current,[setmem(v('t'),'active',lit(False)),setmem(v('t'),'selected',lit(False)),
            setmem(v('t'),'status',lit('cancelled'))])]+local_task_cleanup(state)
    watch=[local('t',globals_token()),cond(NOT(alive),[expr(method(view,PREFIX+'cancel')),ret(lit(False))]),ret(lit(True))]
    open_body=assemble([
        cond(NOT(method(view,PREFIX+'watch')),[ret(UNDEF)]),
        local('t',globals_token()),
        cond(NE(m('t','status'),lit('opening')),[ret(UNDEF)]),
        setmem(v('t'),'status',lit('awaiting')),
        # Consume/remove this one-shot before native Open can synchronously reenter.
        deletemem(v('this'),'onEnterFrame'),expr(method(v('this'),'removeMovieClip')),setmem(state,'child',UNDEF)])
    open_body+=manual_open
    arm=[
        cond(NOT(v('show')),[
            expr(method(view,PREFIX+'cancel')),setmem(view,PREFIX+'started',lit(False)),ret(UNDEF)]),
        cond(EQ(mem(view,PREFIX+'started'),lit(True)),[ret(UNDEF)]),
        cond(NE(mem(controller(),'_selectCharacter'),view),[ret(UNDEF)]),
        cond(NE(mem(owner,'bWidgetOpen'),lit(True)),[ret(UNDEF)]),
        setmem(view,PREFIX+'started',lit(True)),
        local('previous',globals_token()),
        cond(exists(v('previous')),[
            setmem(v('previous'),'active',lit(False)),setmem(v('previous'),'selected',lit(False)),
            setmem(v('previous'),'status',lit('superseded'))]),
        local('generation',mem(var('_global'),TOKEN+'Generation')),
        cond(NE(TYPE(v('generation')),lit('number')),[put('generation',lit(0))]),
        put('generation',ADD(v('generation'),lit(1))),setmem(var('_global'),TOKEN+'Generation',v('generation')),
        local('t',obj()),setmem(v('t'),'generation',v('generation')),
        setmem(v('t'),'active',lit(True)),setmem(v('t'),'selected',lit(True)),
        setmem(v('t'),'status',lit('opening')),setmem(v('t'),'deadline',ADD(now(),lit(10000))),
        setmem(var('_global'),TOKEN,v('t')),setmem(state,'generation',v('generation')),
        setmem(state,'child',method(owner,'createEmptyMovieClip',lit(PREFIX+'openFrame'),method(owner,'getNextHighestDepth'))),
    ]
    a=Assembler();a.statements(arm)
    a.value(mem(state,'child'));a.value(lit('onEnterFrame'));a.emit(function_bytes('',[],open_body));a.emit(b'\x4f')
    a.statements([setmem(state,'timer',call('setInterval',view,lit(PREFIX+'watch'),lit(100)))])
    arm_body=a.finish()
    cleanup=lambda old:[expr(method(view,PREFIX+'cancel')),
        cond(EQ(TYPE(mem(view,old)),lit('function')),[
            expr(method(mem(view,old),'apply',v('this'),v('arguments')))])]
    setup=[
        local(PREFIX+'view',reg(1)),local(PREFIX+'owner',reg(3)),
        setmem(view,PREFIX+'state',obj()),setmem(view,PREFIX+'started',lit(False)),
        setmem(view,PREFIX+'cancel',fn([],cancel)),setmem(view,PREFIX+'watch',fn([],watch)),
        setmem(view,PREFIX+'oldUnload',mem(owner,'onUnload')),
        setmem(view,PREFIX+'oldRemove',mem(owner,'$beforeRemoveMovieClip')),
        setmem(owner,'onUnload',fn([],cleanup(PREFIX+'oldUnload'))),
        setmem(owner,'$beforeRemoveMovieClip',fn([],cleanup(PREFIX+'oldRemove')))]
    a=Assembler();a.statements(setup);a.value(view);a.value(lit(PREFIX+'show'))
    a.emit(function_bytes('',['show'],arm_body));a.emit(b'\x4f')
    return a.finish()


def select_show_tail():
    view=mem(reg(1),'_selectCharacter')
    return assemble([cond(EQ(TYPE(mem(view,PREFIX+'show')),lit('function')),[
        expr(method(view,PREFIX+'show',reg(3)))])])


def helper_functions():
    return {'system':system_helpers(),'select':function_bytes(PREFIX+'start',[],select_start(b''))}

def _append(action, raw):
    if action.children is None:
        raise FormatError('Expected function body')
    action.children += parse_actions(raw, fresh=True)


def _prepend(action, raw):
    if action.children is None:
        raise FormatError('Expected function body')
    action.children = parse_actions(raw, fresh=True)+action.children


def patch_movie(raw, name):
    header,tags=swf_tree(raw)
    original_groups={a.group for a in all_actions(tags)}
    if write_swf(header,tags)!=raw: raise FormatError('Original SWF does not round-trip exactly')
    by_offset={a.start:a for a in all_actions(tags)}
    if name=='SystemOption':
        # Defined before native Init, which may call back synchronously.
        first=next(t for t in tags if t.kind==12 and t.start==0x874)
        first.actions=parse_actions(system_helpers(),fresh=True)+first.actions
        _append(by_offset[0x9acd],assemble([expr(call(PREFIX+'data',reg(7)))]))
        _append(by_offset[0x8d34],assemble([expr(call(PREFIX+'show',reg(3),reg(4)))]))
        # Any explicit user action takes ownership before the original handler.
        # The automatic video wrapper is intentionally not intercepted.
        takeovers={0x36c3,0x3e73,0x3f12,0xc92b,0xc9c1}
        for offset in sorted(takeovers):
            _prepend(by_offset[offset],assemble([expr(call(PREFIX+'takeover'))]))
        changed={0x9acd,0x8d34}|takeovers
    elif name=='SelectCharacter':
        # Exact manual-open bytecode is copied within the same original pool.
        manual=write_actions(by_offset[0x9a92].children)
        _append(by_offset[0x96a9],select_start(manual))
        _prepend(by_offset[0x9a92],cancel_prefix())
        _prepend(by_offset[0xa593],cancel_prefix(reg(1),reset=True))
        _prepend(by_offset[0xa9cb],cancel_prefix(reg(1),reset=True))
        _append(by_offset[0x3449d],select_show_tail())
        changed={0x96a9,0x9a92,0xa593,0xa9cb,0x3449d}
    else:
        raise FormatError('Unknown movie')
    output=write_swf(header,tags)
    # Every original action outside the scoped function trees remains exact,
    # apart from relocated branches over a growing function definition.
    _,again=swf_tree(output)
    if write_swf(*swf_tree(output))!=output:
        raise FormatError('SWF round-trip validation failed')
    inverse=copy.deepcopy(tags)
    def strip_tags(items):
        def strip_actions(items):
            kept=[a for a in items if a.group in original_groups]
            for a in kept:
                if a.children is not None:a.children=strip_actions(a.children)
            return kept
        for t in items:
            if t.actions is not None:t.actions=strip_actions(t.actions)
            if t.children is not None:strip_tags(t.children)
    strip_tags(inverse)
    if write_swf(header,inverse)!=raw:
        raise FormatError('Removing injected actions did not restore every original SWF byte')
    return output,sorted(changed)


def movie_export(image,name):
    matches=[e for e in image.exports if e.object_path==name and e.class_name=='GFxUI.GFxMovieInfo']
    if len(matches)!=1: raise FormatError('Missing/duplicate expected GFx export')
    e=matches[0]
    properties,_=_properties(image,e)
    matches=[p for p in properties if p[0]=='RawData' and p[1]=='ArrayProperty']
    if len(matches)!=1: raise FormatError('Missing/duplicate RawData property')
    _,_,start,end=matches[0]
    count=struct.unpack_from('<i',e.payload,start+24)[0]
    raw=e.payload[start+28:end]
    if count!=len(raw): raise FormatError('RawData count mismatch')
    swf_tree(raw)
    return e,start,end,raw


def build_package(source,name):
    expected=PINS[name]
    if hashlib.sha256(source).hexdigest()!=expected:
        raise FormatError('Stock source hash does not match pinned '+name)
    original=parse_gpk(source)
    e,start,end,raw=movie_export(original,name)
    patched,changed=patch_movie(raw,name)
    payload=bytearray(e.payload[:start+24]+struct.pack('<i',len(patched))+patched+e.payload[end:])
    struct.pack_into('<i',payload,start+16,len(patched)+4)
    output=bytearray(original.data)
    struct.pack_into('<i',output,e.size_field,len(payload))
    struct.pack_into('<i',output,e.offset_field,len(output))
    output.extend(payload)
    check=parse_gpk(bytes(output))
    if check.names!=original.names or check.imports!=original.imports or len(check.exports)!=len(original.exports):
        raise FormatError('GPK tables changed')
    for before,after in zip(original.exports,check.exports):
        if (before.object_path,before.class_name)!=(after.object_path,after.class_name):
            raise FormatError('GPK export identity changed')
        if before.index!=e.index and (before.payload,before.offset,before.size)!=(after.payload,after.offset,after.size):
            raise FormatError('Unselected GPK export changed')
    normalized=bytearray(original.data)
    struct.pack_into('<i',normalized,e.size_field,len(payload))
    struct.pack_into('<i',normalized,e.offset_field,len(original.data))
    if output[:len(original.data)]!=normalized or len(output)!=len(normalized)+len(payload):
        raise FormatError('GPK bytes outside selected export metadata changed')
    newe,newstart,newend,newraw=movie_export(check,name)
    if newraw!=patched or newe.payload[:start+16]!=e.payload[:start+16] or newe.payload[newend:]!=e.payload[end:]:
        raise FormatError('GFx property/tail validation failed')
    return bytes(output),{'changedFunctionsOriginalOffsets':[hex(n) for n in changed], 'originalMovieBytes':len(raw), 'patchedMovieBytes':len(patched)}


def build(client_root,output):
    client_root=pathlib.Path(client_root).resolve()
    output=pathlib.Path(output).resolve()
    if output==client_root or client_root in output.parents:
        raise FormatError('Output must be outside the game client directory')
    packages=[]; results=[]; pending=[]
    for name in ('SystemOption','SelectCharacter'):
        filename=f'S1UI_{name}.gpk'
        source=client_root.joinpath(*SOURCE_DIR.split('/'),filename)
        raw=source.read_bytes()
        data,details=build_package(raw,name)
        pending.append((filename,data))
        relative=f'{SOURCE_DIR}/{filename}'
        packages.append({'source':relative,'sourceSha256':PINS[name],
            'file':f'assets/lobby-video-settings-v2/{filename}',
            'sha256':hashlib.sha256(data).hexdigest(),'destination':filename})
        results.append({'movie':name,**details})
        if source.read_bytes()!=raw: raise FormatError('Source changed while building')
    # Both inputs/builds validated before the first artifact is written.
    output.mkdir(parents=True,exist_ok=True)
    for filename,data in pending: (output/filename).write_bytes(data)
    manifest={'version':2,'packages':packages}
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8',newline='\n')
    (output/'build-report.json').write_text(json.dumps({'version':2,'packages':results,
        'runtimeVerified':False,'experimental':True,'notes':'V2 tester candidate only. Fixed pinned control schema and local deferred frames are verified offline; ActionScript frames do not prove a native host boundary, and full video apply may reset display resources. Native callback, lifetime and rendering behavior require controlled live acceptance.'},indent=2)+'\n',encoding='utf-8',newline='\n')
    return manifest
