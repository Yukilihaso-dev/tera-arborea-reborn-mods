"""Limited, validated UE3 897/17 package override builder. Never writes input."""
from dataclasses import dataclass
import struct
import zlib
from lzo import decompress as lzo_decompress

class GpkFormatError(ValueError): pass

class Reader:
    def __init__(self,data,pos=0):self.data=data;self.pos=pos
    def take(self,n):
        if n<0 or self.pos<0 or self.pos+n>len(self.data):raise GpkFormatError('Truncated/out-of-bounds package')
        b=self.data[self.pos:self.pos+n];self.pos+=n;return b
    def read(self,fmt):
        values=struct.unpack('<'+fmt,self.take(struct.calcsize('<'+fmt)))
        return values[0] if len(values)==1 else values
    def string(self):
        n=self.read('i')
        if n==0 or abs(n)>1000000:raise GpkFormatError('Invalid string length')
        b=self.take(n if n>0 else -2*n)
        if not b.endswith(b'\0' if n>0 else b'\0\0'):raise GpkFormatError('Unterminated name')
        try:return b[:-1].decode('ascii') if n>0 else b[:-2].decode('utf-16le')
        except UnicodeError as e:raise GpkFormatError('Invalid name encoding') from e

@dataclass
class ExportRecord:
    index:int; class_index:int; super_index:int; owner:int; name:str
    size:int; offset:int; size_field:int; offset_field:int|None
    object_path:str=''; class_name:str=''; payload:bytes=b''

@dataclass
class GpkImage:
    raw:bytes; data:bytes; names:list; imports:list; exports:list
    name_offset:int; compression_offset:int; flags_offset:int

@dataclass
class BuildResult:
    data:bytes; target:str

@dataclass
class ValidationReport:
    valid:bool; changed:list

def _count(n):
    if not 0<=n<=1000000:raise GpkFormatError('Invalid table count')
    return n

def parse_gpk(raw):
    try:return _parse(raw)
    except (struct.error,IndexError,OverflowError,zlib.error,ValueError) as e:
        if isinstance(e,GpkFormatError):raise
        raise GpkFormatError(str(e)) from e

def _parse(raw):
    r=Reader(raw)
    if r.read('I')!=0x9e2a83c1:raise GpkFormatError('Invalid package signature')
    if r.read('HH')!=(897,17):raise GpkFormatError('Unsupported package version')
    r.read('i');r.string();flags_offset=r.pos;flags=r.read('I')
    if flags&0x04000000:raise GpkFormatError('Fully compressed package unsupported')
    nc,no,ec,eo,ic,io,depends=r.read('7i');_count(nc);_count(ec);_count(ic)
    r.take(4+12+16);generations=_count(r.read('i'));r.take(generations*12);r.take(8)
    compression_offset=r.pos;compression,count=r.read('2i');_count(count)
    descriptors=r.pos;chunks=[r.read('4i') for _ in range(count)]
    if chunks:
        if compression not in (1,2):raise GpkFormatError('Unsupported compression')
        first_virtual,_,first_compressed,_=chunks[0]
        if first_compressed-16*count!=first_virtual or first_virtual!=no:raise GpkFormatError('Unsupported compressed summary layout')
        if first_compressed<r.pos or first_compressed>len(raw):raise GpkFormatError('Invalid compressed payload offset')
        header=bytearray(raw[:descriptors]+raw[r.pos:first_compressed])
        if len(header)!=first_virtual:raise GpkFormatError('Summary-tail size mismatch')
        struct.pack_into('<II',header,compression_offset,0,0)
        struct.pack_into('<I',header,flags_offset,flags&~0x02000000)
        data=bytearray(header)
        for uoff,usize,coff,csize in chunks:
            if uoff!=len(data) or usize<=0 or csize<=0:raise GpkFormatError('Invalid/discontinuous chunk')
            cr=Reader(raw,coff);chunk_end=coff+csize
            if chunk_end>len(raw):raise GpkFormatError('Truncated compressed chunk')
            magic,blocksize,total_compressed,total_uncompressed=cr.read('4I')
            if magic!=0x9e2a83c1 or blocksize==0 or total_uncompressed!=usize:raise GpkFormatError('Invalid compressed chunk header')
            sizes=[cr.read('2i') for _ in range((usize+blocksize-1)//blocksize)]
            block_data=bytearray()
            for cs,us in sizes:
                if cs<=0 or us<=0 or us>blocksize or cr.pos+cs>chunk_end:raise GpkFormatError('Invalid compressed block sizes')
                block=cr.take(cs)
                decoded=zlib.decompress(block) if compression==1 else lzo_decompress(block,us)
                if len(decoded)!=us:raise GpkFormatError('Decoded block size mismatch')
                block_data.extend(decoded)
            if cr.pos!=chunk_end or len(block_data)!=usize:raise GpkFormatError('Compressed chunk extent mismatch')
            data.extend(block_data)
        data=bytes(data)
    else:
        if compression or flags&0x02000000:raise GpkFormatError('Compression flags inconsistent')
        data=raw
    nr=Reader(data,no);names=[]
    for _ in range(nc):names.append(nr.string());nr.take(8)
    def fname(value):
        idx=value&0xffffffff;number=value>>32
        if idx>=len(names):raise GpkFormatError('Invalid name reference')
        return names[idx]+(f'_{number-1}' if number else '')
    ir=Reader(data,io);imports=[]
    for _ in range(ic):
        cp,cl,owner,obj=ir.read('qqiq');imports.append((fname(cp),fname(cl),owner,fname(obj)))
    er=Reader(data,eo);exports=[]
    for index in range(1,ec+1):
        ci,si,owner,name=er.read('4i');number,archetype=er.read('2i');er.take(8)
        sf=er.pos;size=er.read('i');of=er.pos if size>0 else None;offset=er.read('i') if size>0 else 0
        er.read('i');generation_count=_count(er.read('i'));er.take(16+generation_count*4+4)
        if size<0 or offset<0 or offset+size>len(data):raise GpkFormatError('Invalid export payload bounds')
        exports.append(ExportRecord(index,ci,si,owner,fname((number<<32)|(name&0xffffffff)),size,offset,sf,of))
    def resolve(idx,seen=()):
        if not idx:return ''
        if idx in seen:raise GpkFormatError('Cyclic object owner')
        if idx>0:
            if idx>len(exports):raise GpkFormatError('Invalid export reference')
            e=exports[idx-1];owner,name=e.owner,e.name
        else:
            if -idx>len(imports):raise GpkFormatError('Invalid import reference')
            _,_,owner,name=imports[-idx-1]
        parent=resolve(owner,seen+(idx,))
        return (parent+'.' if parent else '')+name
    for e in exports:
        e.object_path=resolve(e.index);e.class_name=resolve(e.class_index);e.payload=data[e.offset:e.offset+e.size]
    return GpkImage(raw,data,names,imports,exports,no,compression_offset,flags_offset)

def normalize_uncompressed(image):return image.data

def find_export(image,object_path):
    found=[e for e in image.exports if e.object_path==object_path]
    if len(found)!=1:raise GpkFormatError(f'Missing or duplicate target: {object_path}')
    return found[0]

def _properties(image,e):
    r=Reader(e.payload,4);properties=[]
    while True:
        start=r.pos;ni,nn=r.read('2i')
        if not 0<=ni<len(image.names):raise GpkFormatError('Invalid property name')
        name=image.names[ni]
        if name=='None':return properties,start
        ti,tn,size,array_index=r.read('4i')
        if not 0<=ti<len(image.names) or size<0:raise GpkFormatError('Invalid property tag')
        typ=image.names[ti]
        if typ in ('StructProperty','ByteProperty'):r.take(8)
        if typ=='BoolProperty':r.take(1)
        r.take(size);properties.append((name,typ,start,r.pos))

def _disabled_payload(image,e):
    if e.class_name!='Engine.MaterialEffect':raise GpkFormatError('Target is not a MaterialEffect')
    properties,none_offset=_properties(image,e)
    if any(p[0]=='bShowInGame' for p in properties):raise GpkFormatError('Target already serializes bShowInGame')
    try:ni=image.names.index('bShowInGame');ti=image.names.index('BoolProperty')
    except ValueError as ex:raise GpkFormatError('Required property names absent') from ex
    tag=struct.pack('<6iB',ni,0,ti,0,0,0,0)
    return e.payload[:none_offset]+tag+e.payload[none_offset:]

def disable_material_effect(image,object_path):
    e=find_export(image,object_path);payload=_disabled_payload(image,e)
    if e.offset_field is None:raise GpkFormatError('Empty target payload')
    data=bytearray(normalize_uncompressed(image));new_offset=len(data);data.extend(payload)
    struct.pack_into('<i',data,e.size_field,len(payload));struct.pack_into('<i',data,e.offset_field,new_offset)
    return BuildResult(bytes(data),object_path)

def validate_override(original,rebuilt,targets):
    current=parse_gpk(rebuilt)
    if current.names!=original.names or current.imports!=original.imports or len(current.exports)!=len(original.exports):raise GpkFormatError('Object tables changed')
    if len(targets)!=len(set(targets)):raise GpkFormatError('Duplicate targets')
    expected_prefix=bytearray(original.data);changed=[]
    for old,new in zip(original.exports,current.exports):
        if (old.index,old.class_index,old.super_index,old.owner,old.name,old.object_path)!=(new.index,new.class_index,new.super_index,new.owner,new.name,new.object_path):raise GpkFormatError('Export identity changed')
        if old.object_path in targets:
            if new.payload!=_disabled_payload(original,old):raise GpkFormatError('Unexpected target properties/native tail')
            struct.pack_into('<i',expected_prefix,old.size_field,new.size);struct.pack_into('<i',expected_prefix,old.offset_field,new.offset)
            changed.append(old.object_path)
        elif old.payload!=new.payload or (old.size,old.offset)!=(new.size,new.offset):raise GpkFormatError('Unselected export changed')
    if set(changed)!=set(targets):raise GpkFormatError('Target set mismatch')
    if current.data[:len(original.data)]!=expected_prefix:raise GpkFormatError('Unexpected metadata or original bytes changed')
    if len(current.data)!=len(original.data)+sum(find_export(current,t).size for t in targets):raise GpkFormatError('Unexpected appended data')
    return ValidationReport(True,changed)
