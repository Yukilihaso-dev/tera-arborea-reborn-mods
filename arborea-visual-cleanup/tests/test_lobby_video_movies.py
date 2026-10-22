"""Interpret functions parsed back from V2 artifacts, never native Scaleform."""
import hashlib
import json
import math
import pathlib
import sys
import unittest
sys.dont_write_bytecode=True
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'tools'),str(ROOT.parent/'tests'),str(ROOT/'tests')]
import lobby_video_settings as b
from avm1_vm import VM, AVMFunction, NativeFunction, decode_actions, UNDEFINED
from test_lobby_video_builder import KEYS, EXPECTED, CHECKS, gate_environment, clip, advance, scene

def delivered_movie(name):
    package=b.parse_gpk((ROOT/f'assets/lobby-video-settings-v2/S1UI_{name}.gpk').read_bytes())
    return b.movie_export(package,name)[3]
def root_actions(name):
    _,tags=b.swf_tree(delivered_movie(name))
    if name=='SystemOption':return decode_actions(next(t.body for t in tags if t.kind==12 and t.start==0x874))
    return [action for tag in tags if tag.kind in (12,59) for action in decode_actions(tag.body[2:] if tag.kind==59 else tag.body,base=tag.start+(6 if tag.long else 2)+(2 if tag.kind==59 else 0))]
def walk(actions):
    for action in actions:
        yield action
        yield from walk(action.get('children',[]))
def assigned(actions,key):
    for index,action in enumerate(actions):
        if action['op'] in ('DefineFunction','DefineFunction2') and index and actions[index-1]['op']=='Push' and actions[index-1]['arg'][-1]==key:return action
        if 'children' in action:
            found=assigned(action['children'],key)
            if found:return found
def named(actions):
    return {a['arg']['name']:a for a in actions if a['op'] in ('DefineFunction','DefineFunction2') and a['arg']['name']}
def install(vm,root,actions,extra=()):
    for name,definition in named(actions).items():
        if name.startswith(b.PREFIX) or name in extra:vm.run([definition],locals=root)

class DeliveredMoviesTests(unittest.TestCase):
    def test_manifest_hashes_and_exact_package_movie_roundtrips(self):
        manifest=json.loads((ROOT/'assets/lobby-video-settings-v2/manifest.json').read_text())
        self.assertEqual(manifest['version'],2);self.assertEqual(len(manifest['packages']),2)
        for entry in manifest['packages']:
            self.assertEqual(hashlib.sha256((ROOT/entry['file']).read_bytes()).hexdigest(),entry['sha256'])
            movie=delivered_movie(entry['destination'][5:-4])
            self.assertEqual(b.write_swf(*b.swf_tree(movie)),movie)
    def test_actual_original_serializer_and_wrapper_require_fixed_complete_schema(self):
        actions=root_actions('SystemOption');root=gate_environment()
        keypush=next(a['arg'] for a in actions if a['op']=='Push' and a['arg'] and a['arg'][0]=='videoOptionIndex')
        self.assertEqual(list(reversed(keypush[1:-1])),KEYS)
        root['lib']['Debuger']={'trace':lambda *args:None}
        vm=VM(root=root,max_steps=1000000)
        install(vm,root,actions,('getVideoOptionResult','getOptionValue','ToGame_SystemOption_VideoOptionResult'))
        valid=lambda snapshot:vm.call(root[b.PREFIX+'valid'],[snapshot])
        payload=vm.call(root['getVideoOptionResult']);self.assertEqual(len(payload.split('\t')),30)
        self.assertTrue(valid(root['snapshot']))
        controls=root['container_mc']['setUp2_mc']
        for key in EXPECTED:
            if key=='FS':continue
            control=controls.pop(key+'_mc')
            self.assertFalse(valid(root['snapshot']),key)
            controls[key+'_mc']=control
        for present in ([],['AS'],['AS','RN']):
            root['container_mc']['setUp2_mc']={k:v for k,v in controls.items() if k.startswith('FS') or k[:-3] in present}
            for snapshot in ('FS:0',root['snapshot'],'\n'.join(k+':0' for k in KEYS)):self.assertFalse(valid(snapshot),(present,snapshot))
        root['container_mc']['setUp2_mc']=controls
        vm.call(root['ToGame_SystemOption_VideoOptionResult'])
        self.assertEqual(vm.fscommands,[('FSCommand:ToGame_SystemOption_VideoOptionResult',payload,0)])
    def test_actual_saved_and_show_callbacks_finish_stock_work_then_only_record(self):
        vm,sv,root,view,owner,timers,calls,controller=scene()
        actions=root_actions('SystemOption');controls=root['container_mc']['setUp2_mc']
        for key in EXPECTED:
            if key=='FS':continue
            control=controls[key+'_mc']
            if key in ('SR','RN','CL'):
                control=control['combo_mc'];control.update({'active':True,'addListener':lambda *args:None,'setEnabled':lambda *args:None})
            elif key not in CHECKS:
                control.update({'split_mc':{'_name':'split','getDepth':lambda:0},
                    'createEmptyMovieClip':lambda *args:None,'setData':lambda *args:None})
        controls['AS_mc'].update({'_name':'AS_mc','_parent':controls});controls['ASR_mc']={'checked':True}
        root.update({'bWidgetOpen':False,'MAXSCALE':130,'TextField':object(),
            'videoOptionItemList':[],'videoOptionCategoryList':[],'SPER':':','comboLostner':{},
            'optionItemSetData':lambda *args:None,'getTagIndex':lambda *args:0,
            'historySave_All':lambda:None,'cancelCustomize':lambda:None})
        root['lib'].update({'info':{'AlignInfo':{'scaleRatio':1}},'Debuger':{'trace':lambda *args:None}})
        install(vm,root,actions,('sliderWork','comboBoxWork','getVideoOptionResult','getOptionValue','setOptionValue','setScreenMode','setAutoVideoOption','ToGame_SystemOption_VideoOptionResult'))
        sv.call(view[b.PREFIX+'show'],[True],this=view);advance(sv,owner)
        saved=AVMFunction(assigned(actions,'OnGame_SystemOption_SetVideoOption'),[root],root)
        show=AVMFunction(assigned(actions,'OnGameEventShowWindow'),[root],root)
        vm.call(saved,[root['snapshot']])
        self.assertTrue(root['comboLostner']['flag']);self.assertFalse(controls['ASR_mc']['checked'])
        self.assertEqual(controls['GR_mc']['defV'],2)
        self.assertEqual(root[b.PREFIX+'state']['snapshot'],root['snapshot']);self.assertEqual(vm.fscommands,[])
        vm.call(show,['SystemOption',True],this=vm.globals)
        self.assertTrue(root['bWidgetOpen']);self.assertEqual(vm.fscommands,[]);self.assertEqual(calls,['open'])
        during=[]
        def reenter(machine,url,target,flags):
            during.append('apply-enter')
            advance(vm,root['UI'])
            vm.call(root[b.PREFIX+'frame'])
            vm.call(saved,[root['snapshot']])
            self.assertEqual(calls,['open'])
            self.assertEqual(len(vm.fscommands),1)
            during.append('apply-return')
        vm.fscommand_handler=reenter
        advance(vm,root['UI'])
        self.assertEqual(during,['apply-enter','apply-return'])
        self.assertEqual(len(vm.fscommands),1);self.assertEqual(calls,['open'])
        advance(vm,root['UI']);self.assertEqual(calls,['open','close'])
        self.assertTrue(root['UI']['_visible'])
    def test_actual_mouse_handlers_cancel_automation_and_preserve_original_noop_path(self):
        for name in ('OnGame_MouseDown','OnGame_MouseUp'):
            vm,sv,root,view,owner,timers,calls,controller=scene()
            actions=root_actions('SystemOption');install(vm,root,actions)
            sv.call(view[b.PREFIX+'show'],[True],this=view);advance(sv,owner)
            vm.call(root[b.PREFIX+'show'],['SystemOption',True]);vm.call(root[b.PREFIX+'data'],[root['snapshot']])
            root['keyMapOptionCon']={};root['selectFocusFd']=UNDEFINED
            callback=AVMFunction(assigned(actions,name),[root],root)
            vm.call(callback,[0,{}],this=root)
            self.assertFalse(vm.globals[b.TOKEN]['active'],name)
            advance(vm,root['UI']);self.assertEqual(calls,['open'],name)
    def test_actual_manual_mouse_before_claim_or_with_stale_state_blocks_later_automation(self):
        for stale in (False,True):
            for name in ('OnGame_MouseDown','OnGame_MouseUp'):
                vm,sv,root,view,owner,timers,calls,controller=scene()
                actions=root_actions('SystemOption');install(vm,root,actions)
                sv.call(view[b.PREFIX+'show'],[True],this=view);advance(sv,owner)
                if stale:root[b.PREFIX+'state']={'generation':0,'stage':'cancelled'}
                root['keyMapOptionCon']={};root['selectFocusFd']=UNDEFINED
                vm.call(AVMFunction(assigned(actions,name),[root],root),[0,{}],this=root)
                self.assertFalse(vm.globals[b.TOKEN]['active'],(stale,name))
                vm.call(root[b.PREFIX+'show'],['SystemOption',True]);vm.call(root[b.PREFIX+'data'],[root['snapshot']])
                advance(vm,root['UI']);advance(vm,root['UI'])
                self.assertEqual(calls,['open'],(stale,name))
    def test_actual_hide_before_claim_or_with_stale_state_blocks_late_callbacks(self):
        for stale in (False,True):
            vm,sv,root,view,owner,timers,calls,controller=scene()
            actions=root_actions('SystemOption');install(vm,root,actions)
            sv.call(view[b.PREFIX+'show'],[True],this=view);advance(sv,owner)
            if stale:root[b.PREFIX+'state']={'generation':0,'stage':'cancelled'}
            root.update({'bWidgetOpen':False,'MAXSCALE':130,'historySave_All':lambda:None,'cancelCustomize':lambda:None})
            root['lib']['info']={'AlignInfo':{'scaleRatio':1}}
            show=AVMFunction(assigned(actions,'OnGameEventShowWindow'),[root],root)
            vm.call(show,['SystemOption',False],this=vm.globals)
            self.assertFalse(vm.globals[b.TOKEN]['active'],stale)
            vm.call(show,['SystemOption',True],this=vm.globals)
            vm.call(root[b.PREFIX+'data'],[root['snapshot']])
            advance(vm,root['UI']);advance(vm,root['UI'])
            self.assertEqual(calls,['open'],stale)
    def test_actual_stale_generation_watch_and_unload_cannot_cancel_new_attempt(self):
        vm,sv,root,view,owner,timers,calls,controller=scene()
        install(vm,root,root_actions('SystemOption'))
        sv.call(view[b.PREFIX+'show'],[True],this=view);advance(sv,owner)
        vm.call(root[b.PREFIX+'show'],['SystemOption',True])
        old_state=root[b.PREFIX+'state'];old_unload=root['UI']['onUnload']
        sv.call(view[b.PREFIX+'show'],[False],this=view)
        sv.call(view[b.PREFIX+'show'],[True],this=view);advance(sv,owner)
        new_token=vm.globals[b.TOKEN]
        self.assertNotEqual(old_state['generation'],new_token['generation'])
        vm.call(old_state['watch'],this=old_state)
        vm.call(old_unload,this=root['UI'])
        self.assertIs(vm.globals[b.TOKEN],new_token)
        self.assertTrue(new_token['active'])
        self.assertEqual(calls,['open','open'])
    def test_actual_user_apply_confirm_and_close_cancel_before_stock_native_work(self):
        for name in ('ToGame_SystemOption_Apply','ToGame_SystemOption_Confirm','ToGame_SystemOption_CloseUI'):
            vm,sv,root,view,owner,timers,calls,controller=scene()
            actions=root_actions('SystemOption');install(vm,root,actions,(name,))
            sv.call(view[b.PREFIX+'show'],[True],this=view);advance(sv,owner)
            vm.call(root[b.PREFIX+'show'],['SystemOption',True]);vm.call(root[b.PREFIX+'data'],[root['snapshot']])
            events=[]
            def original_work(label):
                def run():
                    self.assertFalse(vm.globals[b.TOKEN]['active'])
                    events.append(label)
                return run
            root.update({'tab':{'activedNum':2},'isLobbyOpened':False,
                'cancelCustomize':original_work('customize'),
                'custormizedData':{'clone':lambda:{},'saveDataAll':lambda *args:None}})
            for suffix in ('GameOptionResult','AudioOptionResult','VideoOptionResult','KeyMapOptionResult'):
                root['ToGame_SystemOption_'+suffix]=original_work(suffix)
            if name!='ToGame_SystemOption_CloseUI':root['ToGame_SystemOption_CloseUI']=original_work('close')
            vm.call(root[name])
            self.assertFalse(vm.globals[b.TOKEN]['active'],name)
            self.assertTrue(events,name)
            advance(vm,root['UI'])
            self.assertEqual(calls,['open'],name)
    def test_actual_constructor_registers_only_show_then_later_frame_opens_exact_manual_command(self):
        actions=root_actions('SelectCharacter')
        ctor=next(a for a in actions if a['op']=='DefineFunction2' and a['at']==0x96a9)
        events=[];owner=clip();view={};controller={}
        view.update({'__get__targetMovieClip':lambda:owner,'__get__uiName':lambda:'SelectCharacter'})
        def register(target):controller['_selectCharacter']=target;events.append('register')
        controller.update({'getInstance':lambda:controller,'registerSelectCharacter':register,
            'ToGame_MainMenu_RequestShowUI':lambda command:events.append(('open',command))})
        root={'g4':{'view':{'ViewID':{'SELECT_CHARACTER':'SelectCharacter'},'selectCharacter':{'SelectCharacterController':controller}}},
            'setInterval':lambda *args:1,'clearInterval':lambda *args:None}
        view['__super__']=NativeFunction(lambda vm,this,args:events.append('super'))
        vm=VM(root=root,globals={},max_steps=1000000)
        vm.call(AVMFunction(ctor,[root],view),[owner],this=view)
        self.assertEqual(events,['super','register'])
        show=next(a for a in walk(actions) if a['op'] in ('DefineFunction','DefineFunction2')
            and any(c['op']=='Push' and '__get__uiName' in c['arg'] for c in a.get('children',[]))
            and any(c['op']=='Push' and 'closeUIMotion' in c['arg'] for c in a.get('children',[])))
        vm.call(AVMFunction(show,[root],controller),['SelectCharacter',True],this=controller)
        self.assertEqual(events,['super','register'])
        advance(vm,owner);self.assertEqual(events,['super','register',('open','SystemOption\t1')])
        manual=next(a for a in walk(actions) if a['op'] in ('DefineFunction','DefineFunction2')
            and any(c['op']=='Push' and 'SystemOption\t1' in c['arg'] for c in a.get('children',[]))
            and any(c['op']=='Push' and b.PREFIX+'cancel' in c['arg'] for c in a.get('children',[])))
        vm.call(AVMFunction(manual,[root],owner),this=owner)
        self.assertFalse(vm.globals[b.TOKEN]['active']);self.assertEqual(events[-1],('open','SystemOption\t1'))
if __name__=='__main__':unittest.main()
