"""Independent bounded AVM1 evaluator for actual GFx action bytes in tests.

This is deliberately not a Flash runtime. Unsupported reachable instructions and
unprovided native calls raise AVM1Error. Drawing, event dispatch and real native
graphics application are outside its scope. No production module imports it.
Function closures retain lexical scopes and declaration `this`, but foreign-VM
calls do not model the defining movie's _root or native-command origin. Tests
must not use that boundary to claim cross-movie native safety.
"""
from dataclasses import dataclass
import math
import re
import struct


class AVM1Error(Exception):
    pass


class _Undefined:
    def __repr__(self):
        return 'UNDEFINED'


UNDEFINED = _Undefined()

OPS = {
    0: 'End', 0x0A: 'Add', 0x0B: 'Subtract', 0x0C: 'Multiply',
    0x0D: 'Divide', 0x0E: 'Equals', 0x0F: 'Less', 0x10: 'And',
    0x11: 'Or', 0x12: 'Not', 0x13: 'StringEquals', 0x14: 'StringLength',
    0x17: 'Pop', 0x18: 'ToInteger', 0x1C: 'GetVariable', 0x1D: 'SetVariable',
    0x21: 'StringAdd', 0x26: 'Trace', 0x30: 'RandomNumber', 0x34: 'GetTime',
    0x3A: 'Delete', 0x3B: 'Delete2', 0x3C: 'DefineLocal',
    0x3D: 'CallFunction', 0x3E: 'Return', 0x3F: 'Modulo', 0x40: 'NewObject',
    0x41: 'DefineLocal2', 0x42: 'InitArray', 0x43: 'InitObject',
    0x44: 'TypeOf', 0x47: 'Add2', 0x48: 'Less2', 0x49: 'Equals2',
    0x4A: 'ToNumber', 0x4B: 'ToString', 0x4C: 'PushDuplicate',
    0x4D: 'StackSwap', 0x4E: 'GetMember', 0x4F: 'SetMember',
    0x50: 'Increment', 0x51: 'Decrement', 0x52: 'CallMethod',
    0x53: 'NewMethod', 0x54: 'InstanceOf', 0x55: 'Enumerate2',
    0x60: 'BitAnd', 0x61: 'BitOr', 0x62: 'BitXor', 0x63: 'BitLShift',
    0x64: 'BitRShift', 0x65: 'BitURShift', 0x66: 'StrictEquals',
    0x67: 'Greater', 0x68: 'StringGreater', 0x83: 'GetURL',
    0x87: 'StoreRegister', 0x88: 'ConstantPool', 0x8E: 'DefineFunction2',
    0x96: 'Push', 0x99: 'Jump', 0x9A: 'GetURL2',
    0x9B: 'DefineFunction', 0x9D: 'If',
}


def decode_actions(data, base=0, pool=()):
    """Strictly decode actions, independently of the production assembler.

    Result matches fix04's {at, op, arg, children} shape, with `end` attached.
    Function bodies in ordinary SWF header-only action lengths and bodies
    included in ActionLength are both accepted, without reading out of bounds.
    """
    data = bytes(data)
    p = 0
    out = []

    def need(pos, size, limit):
        if pos < 0 or pos + size > limit:
            raise AVM1Error(f'truncated action at {base + pos:#x}')

    def cstr(pos, limit):
        end = data.find(b'\0', pos, limit)
        if end < 0:
            raise AVM1Error(f'unterminated string at {base + pos:#x}')
        try:
            value = data[pos:end].decode('utf-8')
        except UnicodeDecodeError as exc:
            raise AVM1Error('invalid UTF-8 action string') from exc
        return value, end + 1

    while p < len(data):
        start = p
        code = data[p]
        p += 1
        size = 0
        if code >= 0x80:
            need(p, 2, len(data))
            size = struct.unpack_from('<H', data, p)[0]
            p += 2
        arg_start = p
        end = p + size
        need(p, size, len(data))
        item = {'at': base + start, 'op': OPS.get(code, f'0x{code:02x}'), 'arg': None}
        if code == 0x88:
            need(p, 2, end)
            count = struct.unpack_from('<H', data, p)[0]
            p += 2
            pool = []
            for _ in range(count):
                value, p = cstr(p, end)
                pool.append(value)
            item['arg'] = list(pool)
        elif code == 0x96:
            values = []
            widths = {1: 4, 4: 1, 5: 1, 6: 8, 7: 4, 8: 1, 9: 2}
            while p < end:
                kind = data[p]
                p += 1
                if kind == 0:
                    value, p = cstr(p, end)
                elif kind in (2, 3):
                    value = {'null': True} if kind == 2 else {'undefined': True}
                elif kind in widths:
                    width = widths[kind]
                    need(p, width, end)
                    raw = data[p:p + width]
                    p += width
                    if kind == 1:
                        value = struct.unpack('<f', raw)[0]
                    elif kind == 4:
                        value = {'register': raw[0]}
                    elif kind == 5:
                        value = bool(raw[0])
                    elif kind == 6:
                        value = struct.unpack('<d', raw[4:] + raw[:4])[0]
                    elif kind == 7:
                        value = struct.unpack('<i', raw)[0]
                    else:
                        index = int.from_bytes(raw, 'little')
                        if index >= len(pool):
                            raise AVM1Error(f'constant index {index} out of range')
                        value = pool[index]
                else:
                    raise AVM1Error(f'unsupported Push type {kind}')
                values.append(value)
            item['arg'] = values
        elif code in (0x8E, 0x9B):
            name, p = cstr(p, end)
            need(p, 2, end)
            count = struct.unpack_from('<H', data, p)[0]
            p += 2
            registers, flags = None, None
            if code == 0x8E:
                need(p, 3, end)
                registers, flags = data[p], struct.unpack_from('<H', data, p + 1)[0]
                p += 3
            params = []
            for _ in range(count):
                reg = None
                if code == 0x8E:
                    need(p, 1, end)
                    reg = data[p]
                    p += 1
                param, p = cstr(p, end)
                params.append([reg, param])
            need(p, 2, end)
            body_size = struct.unpack_from('<H', data, p)[0]
            p += 2
            body_start = p
            if p != end and p + body_size != end:
                raise AVM1Error('function action length does not match header/body')
            need(body_start, body_size, len(data))
            item['arg'] = {'name': name, 'args': params, 'registers': registers,
                           'flags': flags, 'size': body_size}
            item['children'] = decode_actions(data[p:p + body_size], base + p, pool)
            p += body_size
            end = p
        elif code in (0x99, 0x9D):
            if size != 2:
                raise AVM1Error('invalid branch length')
            delta = struct.unpack_from('<h', data, p)[0]
            item['arg'] = {'delta': delta, 'target': base + end + delta}
            p = end
        elif code == 0x87:
            if size != 1:
                raise AVM1Error('invalid StoreRegister length')
            item['arg'] = data[p]
            p = end
        elif code == 0x83:
            url, p = cstr(p, end)
            target, p = cstr(p, end)
            item['arg'] = (url, target)
        elif code == 0x9A:
            if size != 1:
                raise AVM1Error('invalid GetURL2 length')
            item['arg'] = data[p:p + 1].hex()
            p = end
        else:
            item['arg'] = data[p:end].hex() if size else None
            p = end
        if p != end:
            raise AVM1Error(f'unconsumed action payload at {base + arg_start:#x}')
        item['end'] = base + end
        out.append(item)
    return out


def to_number(value):
    if value is UNDEFINED:
        return math.nan
    if value is None:
        return 0
    if isinstance(value, (bool, int, float)):
        return int(value) if isinstance(value, bool) else value
    if isinstance(value, str):
        whitespace = '\t\n\v\f\r \u00a0\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
        token = value.strip(whitespace)
        if not token:
            return 0
        if re.fullmatch(r'0[xX][0-9a-fA-F]+', token):
            return int(token, 16)
        if re.fullmatch(r'[+-]?(?:Infinity|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)', token):
            return float(token)
        return math.nan
    return math.nan


def to_string(value):
    if value is UNDEFINED:
        return 'undefined'
    if value is None:
        return 'null'
    if value is True:
        return 'true'
    if value is False:
        return 'false'
    if isinstance(value, float):
        if math.isnan(value):
            return 'NaN'
        if math.isinf(value):
            return 'Infinity' if value > 0 else '-Infinity'
        if value.is_integer():
            return str(int(value))
    if isinstance(value, list):
        return ','.join('' if v is None or v is UNDEFINED else to_string(v) for v in value)
    if isinstance(value, dict):
        return '[object Object]'
    return str(value)


def truthy(value):
    if value is UNDEFINED or value is None or value is False:
        return False
    if isinstance(value, (int, float)):
        return value != 0 and not math.isnan(value)
    return value != ''


def strict_equals(a, b):
    if isinstance(a, bool) != isinstance(b, bool):
        return False
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    if type(a) is not type(b):
        return False
    if isinstance(a, (dict, list, AVMFunction, NativeFunction)):
        return a is b
    return a == b


def equals(a, b):
    if (a is UNDEFINED or a is None) and (b is UNDEFINED or b is None):
        return True
    if type(a) is type(b):
        return strict_equals(a, b)
    if isinstance(a, (str, int, float, bool)) and isinstance(b, (str, int, float, bool)):
        return to_number(a) == to_number(b)
    return False


@dataclass
class AVMFunction:
    action: dict
    scopes: list
    this: object


@dataclass
class NativeFunction:
    """Explicit boundary stub: callback(vm, this, args)."""
    callback: object


class VM:
    def __init__(self, globals=None, root=None, max_steps=100000, variables=None):
        self.globals = globals if globals is not None else {}
        self.variables = variables if variables is not None else (root if root is not None else {})
        self.root = root if root is not None else self.variables
        self.max_steps = max_steps
        self.steps = 0
        self.time_ms = 0
        self.fscommands = []
        self.fscommand_handler = None
        self.trace = []
        self.result = UNDEFINED
        self.last_stack = []
        self._active_scopes = []
        self.builtins = {
            'Number': lambda value=UNDEFINED: to_number(value),
            'String': lambda value='': to_string(value),
            'Boolean': lambda value=UNDEFINED: truthy(value),
            'isNaN': lambda value=UNDEFINED: math.isnan(to_number(value)),
            'Object': lambda: {}, 'Array': lambda *args: list(args),
            'Math': {'min': min, 'max': max, 'floor': math.floor, 'ceil': math.ceil},
        }

    def get_variable(self, name, scopes, this):
        name = to_string(name)
        special = {'_global': self.globals, '_root': self.root,
                   '_level0': self.root, 'this': this, 'undefined': UNDEFINED}
        if name in special:
            return special[name]
        for scope in scopes:
            if name in scope:
                return scope[name]
        if name in self.variables:
            return self.variables[name]
        if name in self.builtins:
            return self.builtins[name]
        if '.' in name:
            parts = name.split('.')
            value = self.get_variable(parts[0], scopes, this)
            for part in parts[1:]:
                value = self.get_member(value, part)
            return value
        return UNDEFINED

    def set_variable(self, name, value, scopes, this):
        name = to_string(name)
        for scope in scopes:
            if name in scope:
                scope[name] = value
                return
        if name in self.variables or not scopes:
            self.variables[name] = value
        else:
            # AS2 SetVariable resolves existing lexical variables first, then
            # targets the movie scope, unlike DefineLocal's activation record.
            self.variables[name] = value

    def get_member(self, obj, key):
        if obj is UNDEFINED or obj is None:
            return UNDEFINED
        key = to_string(key)
        if key == 'apply' and (isinstance(obj, (AVMFunction, NativeFunction)) or callable(obj)):
            def apply(machine, _function_receiver, args):
                receiver = args[0] if args else UNDEFINED
                if receiver is UNDEFINED:
                    receiver = None
                values = args[1] if len(args) > 1 else UNDEFINED
                if values is None or values is UNDEFINED:
                    values = []
                if not isinstance(values, list):
                    raise AVM1Error('Function.apply argument list requires a provided array')
                return machine.call(obj, values, this=receiver)
            return NativeFunction(apply)
        if isinstance(obj, dict):
            return obj.get(key, UNDEFINED)
        if isinstance(obj, (list, str)):
            if key == 'length':
                return len(obj)
            try:
                index = int(key)
                return obj[index] if index >= 0 and index < len(obj) else UNDEFINED
            except ValueError:
                return self._sequence_method(obj, key)
        return getattr(obj, key, UNDEFINED)

    def set_member(self, obj, key, value):
        key = to_string(key)
        if obj is UNDEFINED or obj is None:
            # AVM1 silently ignores writes through undefined movie members.
            return
        if isinstance(obj, dict):
            obj[key] = value
        elif isinstance(obj, list):
            if key == 'length':
                length = int(to_number(value))
                if length < 0:
                    raise AVM1Error('negative array length')
                obj[length:] = []
                obj.extend([UNDEFINED] * max(0, length - len(obj)))
            else:
                try:
                    index = int(key)
                except ValueError as exc:
                    raise AVM1Error('array custom properties unsupported') from exc
                if index < 0:
                    raise AVM1Error('negative array index unsupported')
                obj.extend([UNDEFINED] * max(0, index + 1 - len(obj)))
                obj[index] = value
        else:
            setattr(obj, key, value)

    def _sequence_method(self, obj, name):
        if name == 'charCodeAt' and isinstance(obj, str):
            def char_code_at(index=0):
                number = to_number(index)
                if math.isnan(number):
                    number = 0
                if not math.isfinite(number):
                    return math.nan
                position = int(number)
                units = obj.encode('utf-16-le', errors='surrogatepass')
                if position < 0 or position >= len(units) // 2:
                    return math.nan
                return int.from_bytes(units[position * 2:position * 2 + 2], 'little')
            return char_code_at
        if name == 'split' and isinstance(obj, str):
            return lambda separator=UNDEFINED: [obj] if separator is UNDEFINED else (list(obj) if separator == '' else obj.split(to_string(separator)))
        if name == 'toLowerCase' and isinstance(obj, str):
            return obj.lower
        if name == 'toString':
            return lambda: to_string(obj)
        if isinstance(obj, list):
            if name == 'push':
                def push(*args):
                    obj.extend(args)
                    return len(obj)
                return push
            if name == 'pop':
                return lambda: obj.pop() if obj else UNDEFINED
            if name == 'join':
                return lambda sep=',': to_string(sep).join('' if v is None or v is UNDEFINED else to_string(v) for v in obj)
            if name == 'splice':
                def splice(start, count, *items):
                    start = int(to_number(start))
                    start = max(0, len(obj) + start) if start < 0 else min(len(obj), start)
                    count = max(0, int(to_number(count)))
                    removed = obj[start:start + count]
                    obj[start:start + count] = list(items)
                    return removed
                return splice
        return UNDEFINED

    def call(self, function, args=(), this=None):
        args = list(args)
        if isinstance(function, NativeFunction):
            return function.callback(self, this, args)
        if isinstance(function, AVMFunction):
            arg = function.action['arg']
            local = {}
            registers = {}
            flags = arg.get('flags') or 0
            is_function2 = function.action['op'] == 'DefineFunction2'
            actual_this = function.this if this is None else this
            if not is_function2 or not (flags & 2):
                local['this'] = actual_this
            if not is_function2 or not (flags & 8):
                local['arguments'] = args
            if not is_function2 or not (flags & 32):
                local['super'] = self.get_member(actual_this, '__super__')
            preload = [(1, actual_this), (4, args),
                       (16, self.get_member(actual_this, '__super__')),
                       (64, self.root), (128, self.get_member(actual_this, '_parent')),
                       (256, self.globals)]
            register = 1
            if is_function2:
                for flag, value in preload:
                    if flags & flag:
                        registers[register] = value
                        register += 1
            for index, param in enumerate(arg.get('args', [])):
                reg, name = param
                value = args[index] if index < len(args) else UNDEFINED
                if reg:
                    registers[reg] = value
                else:
                    local[name] = value
            return self.run(function.action.get('children', []), local, registers,
                            actual_this, scopes=[local] + function.scopes)
        if callable(function):
            return function(*args)
        raise AVM1Error(f'unbound/noncallable function: {function!r}')

    def _fscommand(self, url, target, flags):
        record = (to_string(url), to_string(target), flags)
        self.fscommands.append(record)
        if self.fscommand_handler is not None:
            self.fscommand_handler(self, *record)

    def run(self, actions, locals=None, registers=None, this=None, scopes=None):
        if isinstance(actions, (bytes, bytearray)):
            actions = decode_actions(actions)
        local = locals if locals is not None else self.variables
        scopes = scopes if scopes is not None else [local]
        registers = registers if registers is not None else {}
        stack = []
        positions = {action['at']: index for index, action in enumerate(actions)}
        code_end = actions[-1].get('end') if actions else None
        pc = 0

        def pop():
            if not stack:
                raise AVM1Error('operand stack underflow')
            return stack.pop()

        def call_args():
            count = to_number(pop())
            if not math.isfinite(count) or int(count) != count or count < 0 or count > len(stack):
                raise AVM1Error('invalid argument count')
            return [pop() for _ in range(int(count))]

        while pc < len(actions):
            self.steps += 1
            if self.steps > self.max_steps:
                raise AVM1Error('instruction limit exceeded')
            action = actions[pc]
            pc += 1
            op, arg = action['op'], action.get('arg')
            if op == 'End':
                break
            if op == 'ConstantPool':
                continue
            if op == 'Push':
                for value in arg:
                    if isinstance(value, dict):
                        if 'register' in value:
                            value = registers.get(value['register'], UNDEFINED)
                        elif value.get('undefined'):
                            value = UNDEFINED
                        elif value.get('null'):
                            value = None
                        else:
                            raise AVM1Error('unknown Push operand')
                    stack.append(value)
            elif op == 'Pop':
                pop()
            elif op == 'StoreRegister':
                if not stack:
                    raise AVM1Error('operand stack underflow')
                registers[arg] = stack[-1]
            elif op == 'PushDuplicate':
                if not stack:
                    raise AVM1Error('operand stack underflow')
                stack.append(stack[-1])
            elif op == 'StackSwap':
                a, b = pop(), pop()
                stack.extend([a, b])
            elif op == 'GetVariable':
                stack.append(self.get_variable(pop(), scopes, this))
            elif op in ('SetVariable', 'DefineLocal'):
                value, name = pop(), pop()
                if op == 'DefineLocal':
                    local[to_string(name)] = value
                else:
                    self.set_variable(name, value, scopes, this)
            elif op == 'DefineLocal2':
                local[to_string(pop())] = UNDEFINED
            elif op == 'GetMember':
                key, obj = pop(), pop()
                stack.append(self.get_member(obj, key))
            elif op == 'SetMember':
                value, key, obj = pop(), pop(), pop()
                self.set_member(obj, key, value)
            elif op in ('DefineFunction', 'DefineFunction2'):
                function = AVMFunction(action, list(scopes), this)
                if arg.get('name'):
                    local[arg['name']] = function
                else:
                    stack.append(function)
            elif op in ('CallFunction', 'NewObject'):
                name = pop()
                args = call_args()
                function = self.get_variable(name, scopes, this) if isinstance(name, str) else name
                stack.append(self.call(function, args, this=this))
            elif op in ('CallMethod', 'NewMethod'):
                name, obj = pop(), pop()
                args = call_args()
                direct = name is UNDEFINED or name is None or name == ''
                function = obj if direct else self.get_member(obj, name)
                stack.append(self.call(function, args, this=this if direct else obj))
            elif op == 'Return':
                value = pop()
                self.last_stack = list(stack)
                self.result = value
                return value
            elif op in ('Jump', 'If'):
                if op == 'Jump' or truthy(pop()):
                    target = arg['target']
                    if target == code_end:
                        break
                    if target not in positions:
                        raise AVM1Error(f'branch target {target:#x} is not an action boundary')
                    pc = positions[target]
            elif op == 'InitArray':
                stack.append(call_args())
            elif op == 'InitObject':
                count = int(to_number(pop()))
                if count < 0 or count * 2 > len(stack):
                    raise AVM1Error('invalid object property count')
                result = {}
                for _ in range(count):
                    value, key = pop(), pop()
                    result[to_string(key)] = value
                stack.append(result)
            elif op == 'GetTime':
                stack.append(self.time_ms)
            elif op == 'GetURL2':
                target, url = pop(), pop()
                flags = int(arg, 16) if isinstance(arg, str) else arg
                self._fscommand(url, target, flags)
            elif op == 'GetURL':
                self._fscommand(arg[0], arg[1], 0)
            elif op == 'Trace':
                self.trace.append(to_string(pop()))
            elif op in ('ToNumber', 'ToString', 'ToInteger', 'Not', 'Increment', 'Decrement', 'StringLength', 'TypeOf'):
                value = pop()
                if op == 'ToNumber':
                    value = to_number(value)
                elif op == 'ToString':
                    value = to_string(value)
                elif op == 'ToInteger':
                    number = to_number(value)
                    value = int(number) if math.isfinite(number) else 0
                elif op == 'Not':
                    value = not truthy(value)
                elif op == 'Increment':
                    value = to_number(value) + 1
                elif op == 'Decrement':
                    value = to_number(value) - 1
                elif op == 'StringLength':
                    value = len(to_string(value))
                elif op == 'TypeOf':
                    value = ('undefined' if value is UNDEFINED else 'boolean' if isinstance(value, bool)
                             else 'number' if isinstance(value, (int, float)) else 'string' if isinstance(value, str)
                             else 'function' if callable(value) or isinstance(value, (AVMFunction, NativeFunction)) else 'object')
                stack.append(value)
            elif op == 'InstanceOf':
                constructor, obj = pop(), pop()
                if isinstance(constructor, type):
                    stack.append(isinstance(obj, constructor))
                elif isinstance(obj, dict):
                    stack.append(obj.get('__class__') is constructor)
                else:
                    stack.append(False)
            elif op == 'Enumerate2':
                obj = pop()
                if not isinstance(obj, (dict, list)):
                    raise AVM1Error('Enumerate2 requires provided object')
                keys = list(obj) if isinstance(obj, dict) else list(range(len(obj)))
                stack.extend([None] + list(reversed(keys)))
            elif op in ('Delete', 'Delete2'):
                key = to_string(pop())
                obj = pop() if op == 'Delete' else local
                if not isinstance(obj, dict):
                    raise AVM1Error('Delete requires provided object')
                obj.pop(key, None)
                stack.append(True)
            elif op in ('Add', 'Add2', 'StringAdd', 'Subtract', 'Multiply', 'Divide', 'Modulo',
                        'Equals', 'Equals2', 'StrictEquals', 'StringEquals', 'Less', 'Less2',
                        'Greater', 'StringGreater', 'And', 'Or', 'BitAnd', 'BitOr', 'BitXor',
                        'BitLShift', 'BitRShift', 'BitURShift'):
                b, a = pop(), pop()
                if op == 'StringAdd' or (op == 'Add2' and (isinstance(a, str) or isinstance(b, str))):
                    value = to_string(a) + to_string(b)
                elif op in ('Equals', 'Equals2'):
                    value = equals(a, b)
                elif op == 'StrictEquals':
                    value = strict_equals(a, b)
                elif op == 'StringEquals':
                    value = to_string(a) == to_string(b)
                elif op in ('And', 'Or'):
                    value = truthy(a) and truthy(b) if op == 'And' else truthy(a) or truthy(b)
                elif op == 'StringGreater':
                    value = to_string(a) > to_string(b)
                elif op in ('Less2', 'Greater') and isinstance(a, str) and isinstance(b, str):
                    value = a < b if op == 'Less2' else a > b
                else:
                    na, nb = to_number(a), to_number(b)
                    if op in ('Add', 'Add2'):
                        value = na + nb
                    elif op == 'Subtract':
                        value = na - nb
                    elif op == 'Multiply':
                        value = na * nb
                    elif op == 'Divide':
                        value = na / nb if nb else (math.nan if not na else math.copysign(math.inf, na))
                    elif op == 'Modulo':
                        value = math.fmod(na, nb) if nb else math.nan
                    elif op in ('Less', 'Less2'):
                        value = na < nb
                    elif op == 'Greater':
                        value = na > nb
                    else:
                        ia = int(na) if math.isfinite(na) else 0
                        ib = int(nb) if math.isfinite(nb) else 0
                        if op == 'BitAnd': value = ia & ib
                        elif op == 'BitOr': value = ia | ib
                        elif op == 'BitXor': value = ia ^ ib
                        elif op == 'BitLShift': value = ia << (ib & 31)
                        elif op == 'BitRShift': value = ia >> (ib & 31)
                        else: value = (ia & 0xFFFFFFFF) >> (ib & 31)
                stack.append(value)
            else:
                raise AVM1Error(f'unsupported reachable opcode {op} at {action["at"]:#x}')
        self.last_stack = list(stack)
        self.result = UNDEFINED
        return UNDEFINED


def eval_actions(data, variables=None, global_env=None, this=None, registers=None,
                 pool=(), max_steps=100000):
    vm = VM(globals=global_env, variables=variables, max_steps=max_steps)
    vm.result = vm.run(decode_actions(data, pool=pool), registers=registers,
                       this=vm.variables if this is None else this)
    return vm
