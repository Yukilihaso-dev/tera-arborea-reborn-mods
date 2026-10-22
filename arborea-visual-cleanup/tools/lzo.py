# SPDX-License-Identifier: GPL-2.0-only
# Legacy LZO1X path transcribed from Linux lib/lzo/lzo1x_decompress_safe.c.
# Original copyright (C) 1996-2012 Markus F.X.J. Oberhumer.
# Python transcription and bounds checks for this local build tool.
def decompress(data, expected):
    ip=0; out=bytearray(); state=0
    def read():
        nonlocal ip
        if ip>=len(data):raise ValueError('Truncated LZO stream')
        b=data[ip];ip+=1;return b
    def literal(n):
        nonlocal ip
        if n<0 or ip+n>len(data) or len(out)+n>expected:raise ValueError('LZO literal overrun')
        out.extend(data[ip:ip+n]);ip+=n
    def ext(base):
        n=base
        while True:
            b=read()
            if b:n+=b;break
            n+=255
            if n>expected+255:raise ValueError('LZO length overrun')
        return n
    if not data:raise ValueError('Empty LZO stream')
    if data[0]>17:
        n=read()-17;literal(n);state=n if n<4 else 4
    while True:
        t=read()
        if t<16:
            if state==0:
                n=ext(15) if t==0 else t
                literal(n+3);state=4;continue
            nxt=t&3;m=len(out)-(2049 if state==4 else 1)-(t>>2)-(read()<<2);n=3 if state==4 else 2
        elif t>=64:
            nxt=t&3;m=len(out)-1-((t>>2)&7)-(read()<<3);n=(t>>5)+1
        elif t>=32:
            n=(t&31)+2
            if n==2:n=ext(33)
            ds=read()|(read()<<8);m=len(out)-1-(ds>>2);nxt=ds&3
        else:
            m=len(out)-((t&8)<<11);n=(t&7)+2
            if n==2:n=ext(9)
            ds=read()|(read()<<8);m-=ds>>2;nxt=ds&3
            if m==len(out):break
            m-=0x4000
        if m<0 or m>=len(out) or len(out)+n>expected:raise ValueError('LZO back-reference overrun')
        for k in range(n):out.append(out[m+k])
        literal(nxt);state=nxt
    if len(out)!=expected or ip!=len(data):raise ValueError('LZO size/end mismatch')
    return bytes(out)
