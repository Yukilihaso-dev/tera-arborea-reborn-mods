"""V2 injected AVM1 safeguards. This evaluator is not native Scaleform."""
import pathlib
import struct
import sys
import unittest
sys.dont_write_bytecode=True
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'tools'),str(ROOT.parent/'tests')]
import lobby_video_settings as b
from avm1_vm import eval_actions, NativeFunction, UNDEFINED
KEYS='SR RN FS CR CL GR SF SFS AS AF CD SD BD MD WD CE BE KD SP VL FD TS HM LL MU LS ES PE OPE TX GEL BEQ BEL CEF CED FQ WRE SL FPS CTF'.split()
ABSENT=set('SF SFS WD CE BE VL FD TS HM SL'.split())
EXPECTED=[k for k in KEYS if k not in ABSENT]
# Stock Component DoInitAction 0x8964f maps Comp:S_RadioButton (AS)
# directly to lib.controls.S_CheckBox; the six other entries use that class too.
CHECKS={'AS','PE','FQ','LL','WRE','OPE','CTF'}
def ext_split(text,separator):
    values=text.split(separator)
    if values and values[-1]=='':values.pop()
    return values
def gate_environment():
    checkbox,combo=object(),object();controls={}
    for key in EXPECTED:
        if key=='FS':continue
        controls[key+'_mc']={'defV':2} if key not in ('SR','RN','CL') else {'combo_mc':{'__class__':combo,'defV':2}}
    for key in CHECKS:controls[key+'_mc']={'__class__':checkbox,'checked':True,'_name':key+'_mc','_parent':controls}
    for mode in range(3):controls[f'FS{mode}_mc']={'checked':mode==0}
    values={key:('0' if key=='FS' else '1' if key in CHECKS else '2') for key in EXPECTED}
    records={key:(value if key=='FS' or key in CHECKS else 'zero\tone\t'+value if key in ('SR','RN','CL') else '0\t100\t1\t0\t'+value+'\t0') for key,value in values.items()}
    root={'videoOptionIndex':KEYS.copy(),'container_mc':{'setUp2_mc':controls},'screenMode':0,
        'serialized':'\t'.join(k+':'+v for k,v in values.items()),'snapshot':'\n'.join(k+':'+v for k,v in records.items()),
        'records':records,'serializerCalls':0,
        'lib':{'controls':{'S_CheckBox':checkbox,'S_SimpleComboBox':combo},'util':{'ExtString':{'split':ext_split}}}}
    def serializer():
        root['serializerCalls']+=1
        return root['serialized']
    root['getVideoOptionResult']=serializer
    return root
def clip():
    owner={'children':{},'bWidgetOpen':True,'_visible':True}
    def create(name,depth):
        child={'_name':name,'depth':depth}
        child['removeMovieClip']=lambda:owner['children'].pop(name,None)
        owner['children'][name]=child
        return child
    owner.update({'createEmptyMovieClip':create,'getNextHighestDepth':lambda:100+len(owner['children'])})
    return owner
def advance(vm,owner):
    for child in list(owner['children'].values()):
        handler=child.get('onEnterFrame')
        if handler is not None:vm.call(handler,this=child)
def scene():
    shared={'gbUIMode':True};owner=clip();view={'__get__targetMovieClip':lambda:owner};timers={};calls=[];controller={'_selectCharacter':view}
    variables={'g4':{'view':{'selectCharacter':{'SelectCharacterController':{'getInstance':lambda:controller}}}},
        'setInterval':lambda target,method,delay:timers.setdefault(len(timers)+1,(target,method,delay)) and len(timers),
        'clearInterval':lambda timer:timers.pop(timer,None),'nativeOpen':lambda:calls.append('open')}
    manual=b.assemble([b.expr(b.call('nativeOpen'))])
    sv=eval_actions(b.select_start(manual),variables=variables,global_env=shared,registers={1:view,3:owner})
    root=gate_environment()
    root.update({'g4':variables['g4'],'UI':clip(),'UIname':'SystemOption','setInterval':variables['setInterval'],'clearInterval':variables['clearInterval'],
        'ToGame_SystemOption_VideoOptionResult':lambda:calls.append('apply'),'ToGame_SystemOption_CloseUI':lambda:calls.append('close')})
    vm=eval_actions(b.system_helpers(),variables=root,global_env=shared)
    return vm,sv,root,view,owner,timers,calls,controller
class BuilderTests(unittest.TestCase):
    def valid(self,root,snapshot=None):
        vm=eval_actions(b.system_helpers(),variables=root,global_env={})
        return vm.call(root[b.PREFIX+'valid'],[root['snapshot'] if snapshot is None else snapshot])
    def test_relocation_and_invalid_branch(self):
        fn=b.function_bytes('inside',[],b.assemble([b.ret(b.lit(3))]))
        actions=b.parse_actions(b'\x99'+struct.pack('<Hh',2,len(fn))+fn+b'\x00')
        actions[1].children+=b.parse_actions(b.assemble([b.expr(b.lit('inserted'))]),fresh=True)
        again=b.parse_actions(b.write_actions(actions))
        self.assertEqual(again[0].branch_target,again[2].start)
        with self.assertRaises(b.FormatError):b.write_actions(b.parse_actions(b'\x99\x02\x00\x01\x00'+b.assemble([b.expr(b.lit('value'))])))
    def test_gate_requires_all_40_pinned_keys(self):
        self.assertTrue(self.valid(gate_environment()))
        for keys in ([],KEYS[:-1],KEYS+['NEW'],KEYS[:-1]+[KEYS[0]],list(reversed(KEYS))):
            root=gate_environment();root['videoOptionIndex']=keys
            self.assertFalse(self.valid(root),keys)
    def test_empty_and_partial_trees_fail_with_partial_and_complete_40_snapshots(self):
        for present in ([],['AS'],['AS','RN']):
            for snapshot in ('FS:0',gate_environment()['snapshot'],'\n'.join(k+':0' for k in KEYS)):
                root=gate_environment();controls=root['container_mc']['setUp2_mc']
                root['container_mc']['setUp2_mc']={k:v for k,v in controls.items() if k.startswith('FS') or k[:-3] in present}
                self.assertFalse(self.valid(root,snapshot),(present,snapshot))
                self.assertEqual(root['serializerCalls'],0)
    def test_each_required_control_nested_combo_and_fs_radio_is_mandatory(self):
        for key in [k+'_mc' for k in EXPECTED if k!='FS']+['FS0_mc','FS1_mc','FS2_mc']:
            root=gate_environment();del root['container_mc']['setUp2_mc'][key]
            self.assertFalse(self.valid(root),key)
        for key in ('SR','RN','CL'):
            root=gate_environment();del root['container_mc']['setUp2_mc'][key+'_mc']['combo_mc']
            self.assertFalse(self.valid(root),key)
    def test_complete_snapshot_effective_tokens_and_serialized_values_must_match(self):
        for key in EXPECTED:
            root=gate_environment()
            self.assertFalse(self.valid(root,'\n'.join(k+':'+v for k,v in root['records'].items() if k!=key)),key)
        for key,value in [('AS',' '),('RN','\tmetadata'),('GR','0\t100\t1\t0\t \t0'),('FS','0.0'),('GR','0\t100\t1\t0\t5\t0')]:
            root=gate_environment();records=dict(root['records']);records[key]=value
            self.assertFalse(self.valid(root,'\n'.join(k+':'+v for k,v in records.items())),(key,value))
        for payload in ('FS:0',gate_environment()['serialized'].replace('GR:2','GR:NaN'),gate_environment()['serialized'].replace('AS:1','AS:0')):
            root=gate_environment();root['serialized']=payload
            self.assertFalse(self.valid(root),payload)
    def test_gate_rejects_nonfinite_screen_modes_textfield_and_conflicting_duplicates(self):
        from math import nan,inf
        for mode in (3,-1,'0',True,UNDEFINED,nan,inf):
            root=gate_environment();root['screenMode']=mode
            self.assertFalse(self.valid(root),mode)
        for value in ('NaN','Infinity','-Infinity'):
            root=gate_environment();root['serialized']=root['serialized'].replace('GR:2','GR:'+value)
            self.assertFalse(self.valid(root),value)
        root=gate_environment();self.assertFalse(self.valid(root,root['snapshot']+'\nAS:0'))
        self.assertTrue(self.valid(root,root['snapshot']+'\nAS:1'))
        textfield=object();root['TextField']=textfield
        root['container_mc']['setUp2_mc']['GR_mc']['__class__']=textfield
        self.assertFalse(self.valid(root))
    def test_numeric_token_rejects_historical_whitespace(self):
        root={};vm=eval_actions(b.system_helpers(),variables=root,global_env={})
        for value in ('',' \t\r\n','\u00a0','\u180e','\u2000\u200a','\ufeff'):self.assertFalse(vm.call(root[b.PREFIX+'numberToken'],[value]))
        for value in ('0','-0','1.5','1e2',' 2 '):self.assertTrue(vm.call(root[b.PREFIX+'numberToken'],[value]))
    def test_constructor_only_setup_show_then_later_one_open(self):
        vm,sv,root,view,owner,timers,calls,controller=scene()
        self.assertEqual(calls,[])
        self.assertNotIn(b.TOKEN,sv.globals)
        sv.call(view[b.PREFIX+'show'],[True],this=view)
        self.assertEqual(calls,[])
        sv.call(view[b.PREFIX+'show'],[True],this=view)
        advance(sv,owner);advance(sv,owner)
        self.assertEqual(calls,['open'])
        self.assertEqual(owner['children'],{})
        self.assertTrue(all(isinstance(value,(str,bool,int,float)) for value in sv.globals[b.TOKEN].values()))
    def test_callback_orders_record_only_then_distinct_frames_apply_close(self):
        for order in (('show','data'),('data','show')):
            vm,sv,root,view,owner,timers,calls,controller=scene()
            sv.call(view[b.PREFIX+'show'],[True],this=view);advance(sv,owner)
            def apply():
                calls.append('apply');self.assertEqual(vm.globals[b.TOKEN]['status'],'close')
                vm.call(root[b.PREFIX+'data'],[root['snapshot']])
            root['ToGame_SystemOption_VideoOptionResult']=apply
            for event in order:vm.call(root[b.PREFIX+event],['SystemOption',True] if event=='show' else [root['snapshot']])
            self.assertEqual(calls,['open'])
            advance(vm,root['UI']);self.assertEqual(calls,['open','apply'])
            advance(vm,root['UI']);advance(vm,root['UI']);self.assertEqual(calls,['open','apply','close'])
            self.assertTrue(root['UI']['_visible']);self.assertEqual(root['UI']['children'],{})
    def test_cancellation_never_native_closes(self):
        for reason in ('timeout','manual','hide','owner','unload','remove','generation'):
            vm,sv,root,view,owner,timers,calls,controller=scene()
            sv.call(view[b.PREFIX+'show'],[True],this=view);advance(sv,owner)
            vm.call(root[b.PREFIX+'show'],['SystemOption',True]);vm.call(root[b.PREFIX+'data'],[root['snapshot']])
            if reason=='timeout':sv.time_ms=vm.time_ms=10001;sv.call(view[b.PREFIX+'watch'],this=view)
            elif reason=='manual':sv.call(view[b.PREFIX+'cancel'],this=view)
            elif reason=='hide':sv.call(view[b.PREFIX+'show'],[False],this=view)
            elif reason=='owner':controller['_selectCharacter']={};sv.call(view[b.PREFIX+'watch'],this=view)
            elif reason=='generation':vm.globals[b.TOKEN]={'generation':99,'active':True,'selected':True,'status':'awaiting','deadline':10000}
            else:sv.call(owner['onUnload' if reason=='unload' else '$beforeRemoveMovieClip'],this=owner)
            advance(vm,root['UI']);self.assertEqual(calls,['open'],reason)
            self.assertTrue(root['UI']['_visible']);self.assertEqual(root['UI']['children'],{})
    def test_controls_snapshot_and_ownership_rechecked_before_close(self):
        for mutation in ('control','snapshot','manual','timeout'):
            vm,sv,root,view,owner,timers,calls,controller=scene()
            sv.call(view[b.PREFIX+'show'],[True],this=view);advance(sv,owner)
            vm.call(root[b.PREFIX+'show'],['SystemOption',True]);vm.call(root[b.PREFIX+'data'],[root['snapshot']])
            advance(vm,root['UI']);self.assertEqual(calls,['open','apply'])
            if mutation=='control':del root['container_mc']['setUp2_mc']['GR_mc']
            elif mutation=='snapshot':vm.call(root[b.PREFIX+'data'],['FS:0'])
            elif mutation=='manual':sv.call(view[b.PREFIX+'cancel'],this=view)
            else:vm.time_ms=10001
            advance(vm,root['UI']);self.assertEqual(calls,['open','apply'],mutation)
    def test_local_cleanup_preserves_stock_frame_and_delegate_receiver_arguments(self):
        owner=clip();view={};calls=[];stock=object()
        old=NativeFunction(lambda machine,this,args:calls.append((this,args)))
        owner.update({'onEnterFrame':stock,'onUnload':old,'$beforeRemoveMovieClip':old})
        sv=eval_actions(b.select_start(b''),variables={},global_env={},registers={1:view,3:owner})
        sv.call(owner['onUnload'],[1,2],this=owner);sv.call(owner['$beforeRemoveMovieClip'],[3],this=owner)
        self.assertEqual(calls,[(owner,[1,2]),(owner,[3])]);self.assertIs(owner['onEnterFrame'],stock)
    def test_apply_reentrant_frame_cannot_close_until_apply_returns(self):
        vm,sv,root,view,owner,timers,calls,controller=scene()
        sv.call(view[b.PREFIX+'show'],[True],this=view);advance(sv,owner)
        vm.call(root[b.PREFIX+'show'],['SystemOption',True]);vm.call(root[b.PREFIX+'data'],[root['snapshot']])
        def apply():
            calls.append('apply-enter')
            advance(vm,root['UI'])
            vm.call(root[b.PREFIX+'frame'])
            self.assertEqual(calls,['open','apply-enter'])
            calls.append('apply-return')
        root['ToGame_SystemOption_VideoOptionResult']=apply
        advance(vm,root['UI'])
        self.assertEqual(calls,['open','apply-enter','apply-return'])
        advance(vm,root['UI'])
        self.assertEqual(calls,['open','apply-enter','apply-return','close'])
    def test_fresh_selection_lookup_fails_closed_without_watchdog(self):
        for mutation in ('replacement','hidden','bridge'):
            vm,sv,root,view,owner,timers,calls,controller=scene()
            sv.call(view[b.PREFIX+'show'],[True],this=view);advance(sv,owner)
            vm.call(root[b.PREFIX+'show'],['SystemOption',True]);vm.call(root[b.PREFIX+'data'],[root['snapshot']])
            if mutation=='replacement':controller['_selectCharacter']={}
            elif mutation=='hidden':owner['bWidgetOpen']=False
            else:root['g4']={}
            advance(vm,root['UI'])
            self.assertEqual(calls,['open'],mutation)
    def test_v2_identity(self):
        self.assertIn('V2',b.PREFIX);self.assertIn('_v2_',b.TOKEN)
if __name__=='__main__':unittest.main()
