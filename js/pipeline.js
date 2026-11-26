/* Real execution telemetry. Simulated latency is explicitly separated. */
(function (global) {
  'use strict';
  var SBM=global.SBM||(global.SBM={}), Pipe=SBM.Pipe={};
  Pipe.mode='normal'; Pipe.latencySimMs=0;
  Pipe.stages=[
    {key:'capture',name:'画作采集与预处理',side:'edge'},
    {key:'segment',name:'角色分割（启发式）',side:'edge'},
    {key:'pose',name:'关键点检测与骨骼绑定',side:'edge'},
    {key:'motion',name:'程序化动作生成',side:'edge'},
    {key:'story',name:'故事生成',side:'edge'},
    {key:'bg',name:'风格化背景/道具生成',side:'edge'},
    {key:'tts',name:'浏览器语音合成',side:'edge'}
  ];
  Pipe.state={}; Pipe.reset=function(){Pipe.state={};Pipe.render();};
  Pipe.get=function(key){
    if(!Pipe.state[key]){var d=Pipe.stages.find(function(x){return x.key===key;})||{key:key,name:key,side:'edge'};
      Pipe.state[key]={key:key,name:d.name,side:d.side,sideEff:d.side,status:'idle',ms:0,simulatedMs:0,note:''};}
    return Pipe.state[key];
  };
  function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
  Pipe.wrap=function(key,fn,opts){
    opts=opts||{};var st=Pipe.get(key),side=opts.side||st.side;
    st.status='run';st.sideEff=side;st.note=opts.note||'';st.simulatedMs=0;Pipe.render();
    var now=function(){return global.performance&&performance.now?performance.now():Date.now();},t0=now();
    return Promise.resolve().then(function(){return fn(false);}).then(function(result){
      st.ms=Math.max(0,Math.round(now()-t0));
      var sim=opts.simulateLatency?Math.max(0,Number(Pipe.latencySimMs)||0):0;st.simulatedMs=sim;
      return (sim?sleep(sim):Promise.resolve()).then(function(){return result;});
    }).then(function(result){st.status='ok';Pipe.render();return result;})
      .catch(function(e){st.status='fail';st.note=(e&&e.message)||'执行失败';Pipe.render();throw e;});
  };
  Pipe.mark=function(key,status,note,side){var s=Pipe.get(key);s.status=status;s.note=note||'';if(side)s.sideEff=side;Pipe.render();};
  Pipe.total=function(){var ms=0,sim=0,n=0;Object.keys(Pipe.state).forEach(function(k){var s=Pipe.state[k];if(s.status==='ok'){ms+=s.ms;sim+=s.simulatedMs||0;n++;}});return{ms:ms,simulatedMs:sim,n:n};};
  Pipe.render=function(){
    var ul=document.getElementById('pipeList');if(!ul)return;ul.textContent='';
    Pipe.stages.forEach(function(d){var s=Pipe.state[d.key],li=document.createElement('li');li.className=s?s.status:'idle';
      var dot=document.createElement('span');dot.className='dot';var nm=document.createElement('span');nm.className='nm';nm.textContent=s?s.name:d.name;
      var side=document.createElement('span');side.className='side'+(s&&s.sideEff==='cloud'?' cloud':'');side.textContent=s?(s.sideEff==='cloud'?'云端':'端侧'):'端侧';
      var ms=document.createElement('span');ms.className='ms';ms.textContent=!s||s.status==='idle'?'—':s.status==='run'?'…':s.status==='ok'?s.ms+'ms'+(s.simulatedMs?' (+模拟)':''):'失败';
      li.appendChild(dot);li.appendChild(nm);li.appendChild(side);li.appendChild(ms);ul.appendChild(li);});
    var sum=document.getElementById('pipeSummary');if(sum){var t=Pipe.total();sum.textContent=t.n?'实际执行耗时 '+(t.ms/1000).toFixed(2)+'s（'+t.n+' 个阶段）'+(t.simulatedMs?'；另有 '+t.simulatedMs+'ms 演示延迟，不计入实测':''):'等待任务执行';}
  };
})(window);
