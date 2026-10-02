import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {defaults,roomState,MAX_ROOMS,MAX_VERTICES,footprintOf,visibleOnFloor} from './rooms.mjs?v=controls2';
import {HomeAssistant,DEFAULT_HA_URL,TOKEN_KEY,URL_KEY,loadConnection,saveConnection,forgetConnection,normalizeURL,testConnection} from './ha.mjs?v=unified1';
const $=id=>document.getElementById(id),stage=$('stage');
const rooms=structuredClone(defaults),mode='live';
let snapshot={status:'not_configured',entities:[]},model=null;
function notify(text){$('notice').textContent=text}
const scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0,0);stage.append(renderer.domElement);
const camera=new THREE.PerspectiveCamera(38,1,.1,200),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=4;controls.maxDistance=65;controls.maxPolarAngle=Math.PI*.92;
let activeView='all';
const outdoorLights=[['light.deck_light','Deck Light'],['light.backyard_cam_floodlight','Backyard Floodlight'],['light.front_door','Front Door Light']];
const center=new THREE.Vector3(4.4,1.2,-2.3);
function orbit(){camera.up.set(0,1,0);camera.position.copy(center).add(new THREE.Vector3(17,16,17));controls.target.copy(center);controls.enableRotate=true;controls.update()}
function top(){camera.up.set(0,0,-1);camera.position.copy(center).add(new THREE.Vector3(0,23,.001));controls.target.copy(center);controls.enableRotate=false;controls.update()}
orbit();
new ResizeObserver(()=>{const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix()}).observe(stage);
const uniforms={roomMin:{value:Array.from({length:MAX_ROOMS},()=>new THREE.Vector3())},roomMax:{value:Array.from({length:MAX_ROOMS},()=>new THREE.Vector3())},roomLevel:{value:Array(MAX_ROOMS).fill(-1)},roomCount:{value:0},roomVertexCount:{value:Array(MAX_ROOMS).fill(0)},roomPoints:{value:Array.from({length:MAX_ROOMS*MAX_VERTICES},()=>new THREE.Vector2())}};
const labelLayer=document.createElement('div');labelLayer.className='room-labels';stage.append(labelLayer);
let roomLabels=[];
const pendingControls=new Set();
async function controlEntity(id,brightness){
 const entity=snapshot.entities.find(e=>e.id===id);if(!entity||pendingControls.has(id))return;
 pendingControls.add(id);renderRooms();
 try{await homeAssistant.setEntity(id,entity.state!=='on',brightness);notify('Command accepted. Waiting for the device state.')}catch(error){notify(error.message)}
 finally{pendingControls.delete(id);renderRooms()}
}
function visibleDevices(room){return room.entities.filter(id=>{const entity=snapshot.entities.find(e=>e.id===id);return !!entity&&!entity.members?.length})}
let adjustingBrightness=false;
function appendDeviceControl(container,id,title){
 const entity=snapshot.entities.find(e=>e.id===id);if(!entity)return;
 const row=document.createElement('div');row.className='light-control';
 const head=document.createElement('div');head.className='room-head';
 if(title){const name=document.createElement('span');name.className='room-name';name.textContent=title;head.append(name)}
 const toggle=deviceButton(id);toggle.className='toggle'+(entity.state==='on'?' on':'');toggle.textContent='';head.append(toggle);row.append(head);
 if(entity.dimmable){
  const slider=document.createElement('input');slider.type='range';slider.min=0;slider.max=100;slider.step=1;slider.value=entity.state==='off'?0:Math.round((entity.brightness??255)/255*100);slider.disabled=toggle.disabled;slider.setAttribute('aria-label',`${entity.name} brightness`);slider.title=`${slider.value}%`;
  slider.onclick=e=>e.stopPropagation();slider.oninput=()=>{adjustingBrightness=true;slider.title=`${slider.value}%`};
  slider.onchange=()=>{adjustingBrightness=false;controlEntity(id,Number(slider.value))};slider.onblur=()=>{if(adjustingBrightness){adjustingBrightness=false;renderRooms()}};row.append(slider);
 }
 container.append(row);return toggle;
}
function deviceButton(id,icon=false){
 const entity=snapshot.entities.find(e=>e.id===id),button=document.createElement('button');
 const name=entity?.name||id.replace(/^(light|switch)\./,'').replaceAll('_',' ');
 const on=entity?.state==='on';button.className=(icon?'room-bulb':'device-toggle')+(on?' on':'');
 button.textContent=icon?'☀':`${name} · ${pendingControls.has(id)?'Sending…':entity?.state||'unavailable'}`;
 button.title=`${name}: ${pendingControls.has(id)?'sending':entity?.state||'unavailable'}`;
 button.setAttribute('aria-label',`Turn ${on?'off':'on'} ${name}`);button.setAttribute('aria-pressed',on);
 button.disabled=snapshot.status!=='connected'||pendingControls.has(id)||!['on','off'].includes(entity?.state)||!!entity?.members?.length;
 button.onclick=e=>{e.stopPropagation();controlEntity(id)};return button;
}
function renderLabels(){
 labelLayer.replaceChildren();roomLabels=[];
 for(const room of rooms.filter(r=>visibleOnFloor(r,activeView,true))){
  const devices=visibleDevices(room);
  const button=document.createElement('span');button.className='room-label passive';button.textContent=room.name;
  const bulbs=document.createElement('div');bulbs.className='room-bulbs';
  for(const id of devices){
   const item=document.createElement('div');item.className='room-device';const bulb=deviceButton(id,true);item.append(bulb);
   if(devices.length>1){const label=document.createElement('span');label.textContent=snapshot.entities.find(e=>e.id===id)?.name||id.replace(/^(light|switch)\./,'').replaceAll('_',' ');item.append(label)}
   bulbs.append(item);
  }
  const wrapper=document.createElement('div');wrapper.className='room-marker';wrapper.append(button);if(bulbs.childElementCount)wrapper.append(bulbs);labelLayer.append(wrapper);roomLabels.push({room,button:wrapper});
 }
}
function positionLabels(){
 labelLayer.hidden=activeView==='outside'||!$('show-labels').checked;
 labelLayer.classList.toggle('top-view',['upper','lower'].includes(activeView));
 const occupied=[];
 for(const {room,button} of roomLabels){
  const anchor=room.labelPosition?[...room.labelPosition]:[(room.min[0]+room.max[0])/2,room.min[1]+.15,(room.min[2]+room.max[2])/2];
  if(room.floor==='both')anchor[1]=activeView==='lower'?-2.5:0;
  const p=new THREE.Vector3(...anchor).project(camera);
  button.hidden=p.z < -1||p.z > 1||Math.abs(p.x)>1||Math.abs(p.y)>1;
  const x=(p.x+1)*stage.clientWidth/2,y=(1-p.y)*stage.clientHeight/2,w=button.offsetWidth,h=button.offsetHeight;
  let offset=0;
  for(const dy of (['upper','lower'].includes(activeView)?[0]:[0,-h-5,h+5,-2*(h+5),2*(h+5)])){
   offset=dy;
   if(!occupied.some(r=>Math.abs(x-r.x)<(w+r.w)/2+3&&Math.abs(y+dy-r.y)<(h+r.h)/2+3))break;
  }
  if(!button.hidden)occupied.push({x,y:y+offset,w,h});
  button.style.left=`${x}px`;button.style.top=`${y+offset}px`;
 }
}
function updateVisuals(){
 uniforms.roomCount.value=rooms.length;
 rooms.forEach((room,i)=>{uniforms.roomMin.value[i].fromArray(room.min);uniforms.roomMax.value[i].fromArray(room.max);const state=roomState(room,mode,snapshot);uniforms.roomLevel.value[i]=state.level===null?-1:state.level;const points=footprintOf(room);uniforms.roomVertexCount.value[i]=points.length;points.forEach((p,j)=>uniforms.roomPoints.value[i*MAX_VERTICES+j].fromArray(p))});

}
new GLTFLoader().load('./model/house.glb',gltf=>{
 model=gltf.scene;scene.add(model);
 model.traverse(o=>{if(!o.isMesh)return;const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(material=>{
  material.onBeforeCompile=shader=>{
   Object.assign(shader.uniforms,uniforms);
   shader.vertexShader='varying vec3 housePosition;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nhousePosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
   shader.fragmentShader=`varying vec3 housePosition;\nuniform vec3 roomMin[${MAX_ROOMS}];\nuniform vec3 roomMax[${MAX_ROOMS}];\nuniform float roomLevel[${MAX_ROOMS}];\nuniform int roomCount;\nuniform int roomVertexCount[${MAX_ROOMS}];\nuniform vec2 roomPoints[${MAX_ROOMS*MAX_VERTICES}];
   bool insideRoom(int room,vec2 p){
    bool inside=false;int count=roomVertexCount[room];
    vec2 previous=roomPoints[room*${MAX_VERTICES}+count-1];
    for(int v=0;v<${MAX_VERTICES};v++){
     if(v>=count)break;vec2 current=roomPoints[room*${MAX_VERTICES}+v];
     if((current.y>p.y)!=(previous.y>p.y)){
      if(p.x<(previous.x-current.x)*(p.y-current.y)/(previous.y-current.y)+current.x)inside=!inside;
     }
     previous=current;
    }
    return inside;
   }\n`+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
    for(int room=0;room<${MAX_ROOMS};room++){
      if(room>=roomCount) break;
      if(roomLevel[room]<0.0) continue;
      vec3 outside=max(roomMin[room]-housePosition,housePosition-roomMax[room]);
      float edge=max(outside.x,max(outside.y,outside.z));
      if(edge>0.0 || !insideRoom(room,housePosition.xz))continue;
      float mask=1.0;
      float power=mix(0.18,1.12,roomLevel[room]);
      vec3 tint=mix(vec3(0.76,0.85,1.0),vec3(1.0,0.96,0.86),roomLevel[room]);
      outgoingLight=mix(outgoingLight,outgoingLight*power*tint,mask);
    }
    #include <opaque_fragment>`);
  };
  material.customProgramCacheKey=()=> 'house-room-polygons-v2';material.needsUpdate=true;
 })});$('loading').hidden=true;updateVisuals();
},event=>{if(event.total)$('loading').textContent=`Loading Nathan’s home… ${Math.round(event.loaded/event.total*100)}%`},()=>{$('loading').textContent='Could not load the model. Check that the deployed site includes model/house.glb.'});
function setView(view){
 activeView=view;
 for(const [id,value] of [['orbit','all'],['main-floor','upper'],['basement','lower'],['outside','outside']]){const button=$(id);button.classList.toggle('active',value===view);button.setAttribute('aria-pressed',value===view)}
 renderer.clippingPlanes=['all','outside'].includes(view)?[]:view==='upper'?[new THREE.Plane(new THREE.Vector3(0,1,0),.15)]:[new THREE.Plane(new THREE.Vector3(0,-1,0),-.15)];
 renderer.domElement.hidden=view==='outside';$('outside-view').hidden=view!=='outside';
 $('show-labels').closest('label').hidden=view==='outside';
 document.querySelector('.view-caption').hidden=view==='outside';
 if(view==='all')orbit();else if(view!=='outside')top();
 renderRooms();updateVisuals();
}
for(const [id,view] of [['orbit','all'],['main-floor','upper'],['basement','lower'],['outside','outside']])$(id).onclick=()=>setView(view);
$('aerial-photo').onerror=()=>{$('aerial-error').hidden=false};
function renderOutside(){
 $('outdoor-controls').replaceChildren();$('outdoor-markers').replaceChildren();
 const positions={'light.deck_light':[83,74],'light.backyard_cam_floodlight':[87,28],'light.front_door':[38,53]};
 for(const [id,name] of outdoorLights){
  const card=document.createElement('div');card.className='room';const heading=document.createElement('h3');heading.textContent=name;card.append(heading);
  if(snapshot.entities.some(e=>e.id===id)){
   appendDeviceControl(card,id);const marker=deviceButton(id);marker.classList.add('outdoor-marker');marker.textContent=`☀ ${name}`;marker.style.left=positions[id][0]+'%';marker.style.top=positions[id][1]+'%';$('outdoor-markers').append(marker);
  }
  else {const note=document.createElement('p');note.className='note';note.textContent=snapshot.status==='connected'?'Device not found.':'Waiting for Home Assistant connection.';card.append(note)}
  $('outdoor-controls').append(card);
 }
}
function renderRooms(){
 if(adjustingBrightness)return;
 $('rooms').replaceChildren();renderLabels();
 if(activeView==='outside'){renderOutside();const note=document.createElement('p');note.className='note';note.textContent='Outdoor lights are shown in the Outside view.';$('rooms').append(note);return}

 const primaryIDs=new Set(['primary-bedroom','primary-closet','primary-bath']);
 let primaryGroup=null;
 for(const room of rooms.filter(r=>visibleOnFloor(r,activeView))){
  const devices=visibleDevices(room);
  const card=document.createElement('div');card.className='room';
  const head=document.createElement('div');head.className='room-head';const text=document.createElement('div'),title=document.createElement('span');title.className='room-name';title.textContent=room.id==='primary-bath'?'Primary Vanity / Bath':room.name;text.append(title);head.append(text);
  card.append(head);
  if(devices.length===1){
   const holder=document.createElement('div');const toggle=appendDeviceControl(holder,devices[0]);
   head.append(toggle);const slider=holder.querySelector('input');if(slider)card.append(slider);
  }else for(const id of devices)appendDeviceControl(card,id,snapshot.entities.find(e=>e.id===id)?.name||id);
  if(primaryIDs.has(room.id)){
   if(!primaryGroup){primaryGroup=document.createElement('section');primaryGroup.className='primary-group';primaryGroup.setAttribute('aria-label','Primary lights');const heading=document.createElement('h3');heading.textContent='Primary lights';primaryGroup.append(heading);$('rooms').append(primaryGroup)}
   primaryGroup.append(card);
  }else $('rooms').append(card);
 }
}
const labels={not_configured:'Disconnected · no saved token',connecting:'Connecting to your home',connected:'Your home is connected',auth_failed:'Token rejected · open settings',disconnected:'Home offline · reconnecting',permission_denied:'Home Assistant denied access',connection_error:'Connection failed · open settings',protocol_error:'Connection error · open settings'};
function receiveState(next){snapshot=next;$('mode-note').textContent=next.status==='connected'?'':next.status==='not_configured'?'Connect Home Assistant in settings to control your lights.':'Light controls reconnect automatically.';if($('setup').open&&snapshot.status!=='not_configured')$('connection-result').textContent=labels[snapshot.status]||snapshot.status;const indicator=$('connection'),description=labels[snapshot.status]||snapshot.status;indicator.dataset.state=snapshot.status==='connected'?'connected':['connecting','disconnected'].includes(snapshot.status)?'connecting':'disconnected';indicator.title=description;indicator.setAttribute('aria-label',description);renderRooms();updateVisuals()}
const homeAssistant=new HomeAssistant(receiveState);
function restoreConnection(){
 try{
  const config=loadConnection(localStorage);
  homeAssistant.start(config);
 }catch{homeAssistant.stop();notify('Browser storage is unavailable or the saved connection is invalid. Open Home Assistant settings.')}
}
function refreshSettings(){
 try{const saved=loadConnection(localStorage);$('ha-url').value=saved.url;$('ha-token').value='';$('ha-token').placeholder=saved.token?'Token saved · leave blank to keep it':'Paste a long-lived access token';$('token-state').textContent=saved.token?'A token is saved in this browser.':'No token saved yet.'}
 catch{$('ha-url').value=DEFAULT_HA_URL;$('token-state').textContent='Browser storage is unavailable.'}
}
$('help').onclick=()=>{refreshSettings();$('connection-result').textContent='';$('setup').showModal()};
$('close-help').onclick=()=>$('setup').close();
$('setup').addEventListener('close',()=>{$('ha-token').value=''});
$('connection-form').onsubmit=e=>{
 e.preventDefault();
 try{
  const url=normalizeURL($('ha-url').value.trim());let saved={url:'',token:''};try{saved=loadConnection(localStorage)}catch{}
  const token=$('ha-token').value.trim()||(saved.url===url?saved.token:'');
  if(!token)throw Error('Enter a token for this Home Assistant URL.');
  const config=saveConnection(localStorage,{url,token});homeAssistant.start(config);refreshSettings();$('connection-result').textContent='Saved in this browser. Connecting…';
 }catch(error){$('connection-result').textContent=error.message}
};
$('forget-token').onclick=()=>{
 homeAssistant.stop();
 try{forgetConnection(localStorage);refreshSettings();$('connection-result').textContent='Token removed from this browser. Revoke it in Home Assistant too if you no longer need it.'}
 catch{$('ha-token').value='';$('connection-result').textContent='Disconnected, but storage could not be cleared. Remove HA_TOKEN in your browser’s site settings.'}
};
$('test-connection').onclick=async()=>{
 const button=$('test-connection');button.disabled=true;$('connection-result').textContent='Checking direct WebSocket access…';
 try{await testConnection($('ha-url').value.trim());$('connection-result').textContent='Direct browser connection works. Home Assistant is ready for a token.'}
 catch(error){$('connection-result').textContent=error.message}finally{button.disabled=false}
};
addEventListener('storage',event=>{if(event.key===null||[TOKEN_KEY,URL_KEY].includes(event.key))restoreConnection()});
addEventListener('pagehide',()=>homeAssistant.stop());
addEventListener('pageshow',event=>{if(event.persisted)restoreConnection()});
restoreConnection();
renderRooms();updateVisuals();renderer.setAnimationLoop(()=>{controls.update();positionLabels();renderer.render(scene,camera)});
