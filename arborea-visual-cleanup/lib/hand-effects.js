'use strict';
function createHandEffects(mod,state,clearer){
    const requested=state.clientEligible&&state.settings.hideHandGlow;
    const available=typeof mod.toClient==='function'&&typeof mod.setTimeout==='function'&&typeof mod.clearTimeout==='function';
    const active=!!(requested&&available),hooks=[],missing=[];
    const batches={activation:new Set(),transition:new Set()},deadlines=new Map();
    let disposed=false,generation=0,triggers=0,requests=0,last=null,ownerId=null,awaitingScene=false,lastTrigger=null,transitionReason=null;
    const pending=()=>batches.activation.size+batches.transition.size;
    function ready(){return mod.game.isIngame&&!mod.game.isInLoadingScreen&&mod.game.me?.alive!==false&&typeof mod.game.me?.gameId==='bigint'&&mod.game.me.gameId>0n;}
    function cancel(){
        generation++;ownerId=null;awaitingScene=false;transitionReason=null;
        for(const batch of Object.values(batches)){for(const timer of batch)mod.clearTimeout(timer);batch.clear();}
        deadlines.clear();
    }
    function schedule(kind='activation',reason='activation'){
        if(disposed||!active)return;
        if(!ready()){
            if(mod.game.isIngame&&mod.game.isInLoadingScreen){awaitingScene=true;lastTrigger=reason;}
            return;
        }
        const gameId=mod.game.me.gameId;
        if(ownerId!==gameId){cancel();ownerId=gameId;}
        awaitingScene=false;lastTrigger=reason;triggers=Math.min(Number.MAX_SAFE_INTEGER,triggers+1);
        const batch=batches[kind];
        // Coalesce without postponing the first attempt. A short refresh batch
        // must not cancel the longer actor/scene settling batch.
        let delays=kind==='transition'?[50,500,1500,3000,6000]:[50,500];
        if(batch.size){
            if(kind!=='transition'||transitionReason===reason)return;
            // A later, distinct load signal can arrive near the old deadline.
            // Keep the earliest pending clear and renew only the bounded tail.
            const first=[...batch].reduce((a,b)=>deadlines.get(a)<=deadlines.get(b)?a:b);
            for(const timer of batch)if(timer!==first){mod.clearTimeout(timer);batch.delete(timer);deadlines.delete(timer);}
            delays=[50,1500,3000,6000];
        }
        if(kind==='transition')transitionReason=reason;
        const epoch=generation;
        for(const delay of delays){
            const timer=mod.setTimeout(()=>{
                if(!batch.has(timer))return;
                batch.delete(timer);deadlines.delete(timer);
                if(kind==='transition'&&!batch.size)transitionReason=null;
                if(disposed||epoch!==generation||!ready()||mod.game.me.gameId!==gameId)return;
                const result=clearer.clear();
                if(result.sent)requests=Math.min(Number.MAX_SAFE_INTEGER,requests+1);
                last={sent:result.sent,reason:result.reason,trigger:reason,delayMs:delay};
            },delay);
            batch.add(timer);deadlines.set(timer,Date.now()+delay);
        }
    }
    const onEnter=()=>schedule('transition','enter-game');
    const onLoaded=()=>schedule('transition','loading-complete');
    const onLoading=()=>{cancel();if(!disposed&&active)awaitingScene=true;};
    function observe(name,version,predicate,action,fake=null){
        let hook;
        try{hook=mod.tryHook(name,version,{order:100000000,filter:{fake,modified:null,silenced:false}},event=>{
            if(disposed||event.$silenced===true||!predicate(event))return;
            action(event);
        });}catch(_){}
        if(hook)hooks.push(hook);else missing.push(name);
    }
    if(active){
        const buff=e=>e.id===900008&&e.target===mod.game.me?.gameId;
        observe('S_ABNORMALITY_BEGIN',4,buff,()=>schedule('activation','buff-begin'));
        observe('S_ABNORMALITY_REFRESH',2,buff,()=>schedule('activation','buff-refresh'));
        observe('S_PLAY_EFFECT',1,e=>e.id===116081901&&e.gameId===mod.game.me?.gameId,()=>schedule('activation','played-effect'));
        observe('S_NOCTAN_VARIATION_INFO',1,e=>e.id===1&&e.showEffect===true&&e.$fake===false,()=>schedule('activation','nostrum'),false);
        observe('S_SPAWN_ME',3,e=>e.gameId===mod.game.me?.gameId&&typeof e.alive==='boolean',e=>e.alive?schedule('transition','self-spawn'):cancel());
        observe('S_CREATURE_LIFE',3,e=>e.gameId===mod.game.me?.gameId&&typeof e.alive==='boolean',e=>e.alive?schedule('transition','resurrection'):cancel());
        observe('C_LOAD_TOPO_FIN',1,e=>e.$fake===false,()=>schedule('transition','client-load-finish'),false);
        mod.game.on('enter_game',onEnter);
        mod.game.on('leave_loading_screen',onLoaded);
        mod.game.on('enter_loading_screen',onLoading);
        mod.game.on('leave_game',cancel);
        schedule('activation','startup');
    }
    function status(){return {active:active&&!disposed,missing:[...missing],pending:pending(),awaitingScene,lastTrigger,triggers,requests,last:last?{...last}:null,reason:disposed?'disposed':!requested?'off':!available?'Client visual removal or timer API unavailable.':missing.length?'Automatic cleanup armed; some event definitions unavailable.':'Automatic hand cleanup armed.'};}
    return {status,dispose(){
        if(disposed)return;disposed=true;cancel();
        for(const hook of hooks)mod.unhook(hook);
        if(active){
            mod.game.removeListener('enter_game',onEnter);mod.game.removeListener('leave_loading_screen',onLoaded);
            mod.game.removeListener('enter_loading_screen',onLoading);mod.game.removeListener('leave_game',cancel);
        }
    }};
}
module.exports={createHandEffects};
