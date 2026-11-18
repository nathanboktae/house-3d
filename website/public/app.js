import {roomTemperatures,roomClimates,CENTRAL_CLIMATE,roomTemperature,formatTemperature,climateCommand} from './climate.mjs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {defaults,roomState,MAX_ROOMS,MAX_VERTICES,footprintOf,visibleOnFloor} from './rooms.mjs?v=crawlspace4';
import {HomeAssistant,DEFAULT_HA_URL,TOKEN_KEY,URL_KEY,loadConnection,saveConnection,forgetConnection,normalizeURL,testConnection} from './ha.mjs?v=crawlspace4';
import {OptimisticControls} from './optimistic.mjs?v=1';
import {createRouter,routeURL,shouldHandleLink} from './router.mjs?v=1';
const baseURL=new URL('.',import.meta.url);
// Keep relative assets anchored when pushState changes the document URL.
document.querySelector('base').href=baseURL.href;
const views=await fetch(new URL('./views.json',baseURL)).then(response=>{if(!response.ok)throw Error('Could not load view routes.');return response.json()});
const $=id=>document.getElementById(id),stage=$('stage');
const rooms=structuredClone(defaults),mode='live';
let snapshot={status:'not_configured',entities:[]},model=null;
function notify(text){$('notice').textContent=text}
const scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0,0);stage.append(renderer.domElement);
const camera=new THREE.PerspectiveCamera(38,1,.1,200),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=4;controls.maxDistance=65;controls.maxPolarAngle=Math.PI*.92;
let activeView='all';
const outdoorLights=[['light.deck_light','Deck Light'],['light.backyard_cam_floodlight','Backyard Floodlight'],['light.front_door','Front Door Light'],['light.garage','Garage Light']];
const center=new THREE.Vector3(4.4,1.2,-2.3);
function orbit(){camera.up.set(0,1,0);camera.position.copy(center).add(new THREE.Vector3(17,16,17));controls.target.copy(center);controls.enableRotate=true;controls.update()}
function top(){camera.up.set(0,0,-1);camera.position.copy(center).add(new THREE.Vector3(0,23,.001));controls.target.copy(center);controls.enableRotate=false;controls.update()}
new ResizeObserver(()=>{const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix()}).observe(stage);
const uniforms={roomMin:{value:Array.from({length:MAX_ROOMS},()=>new THREE.Vector3())},roomMax:{value:Array.from({length:MAX_ROOMS},()=>new THREE.Vector3())},roomLevel:{value:Array(MAX_ROOMS).fill(-1)},roomCount:{value:0},roomVertexCount:{value:Array(MAX_ROOMS).fill(0)},roomPoints:{value:Array.from({length:MAX_ROOMS*MAX_VERTICES},()=>new THREE.Vector2())}};
const labelLayer=document.createElement('div');labelLayer.className='room-labels';stage.append(labelLayer);
let roomLabels=[];
const climatePanel=document.createElement('section');climatePanel.className='central-climate';stage.append(climatePanel);
const climatePending=new Map();
function appendTemperature(container,roomID){
 const value=roomTemperature(roomID,snapshot);if(value===null)return;
 const text=document.createElement('span');text.className='room-temperature';text.textContent=value;text.title='Room temperature';container.append(text);
}
function climateIcon(kind){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.classList.add('climate-icon');
 const paths={power:'M12 3v9 M6.34 5.66a8 8 0 1 0 11.32 0',thermometer:'M9 14.5V5a3 3 0 0 1 6 0v9.5a5 5 0 1 1-6 0Z M12 8v10 M10.5 18a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',target:'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M7 12a5 5 0 1 0 10 0a5 5 0 1 0-10 0 M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0'};
 const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[kind]);svg.append(path);return svg;
}
function appendClimate(container,id,title){
 const entity=snapshot.entities.find(e=>e.id===id),pending=climatePending.get(id);
 const card=document.createElement('div');card.className='climate-control';
 if(title){const heading=document.createElement('strong');heading.textContent=title;card.append(heading)}
 const status=document.createElement('div');status.className='climate-status';
 if(snapshot.status!=='connected'||!entity){status.textContent='Unavailable'}else{
  for(const [icon,label,value] of [['thermometer','Current temperature',entity.currentTemperature],['target','Target temperature',entity.temperature]]){
   const reading=document.createElement('span');reading.className='climate-reading';reading.title=label;
   reading.setAttribute('aria-label',`${label}: ${formatTemperature(value)}`);reading.append(climateIcon(icon),document.createTextNode(formatTemperature(value)));status.append(reading);
  }
 }
 if(pending){const note=document.createElement('span');note.textContent='Updating…';status.append(note)}card.append(status);
 const buttons=document.createElement('div');buttons.className='climate-buttons';
 for(const [action,label] of [['power','Power'],['decrease','−'],['increase','+']]){
  const button=document.createElement('button');if(action==='power')button.append(climateIcon('power'));else button.textContent=label;button.dataset.climate=id+':'+action;
  button.setAttribute('aria-label',`${entity?.name||title||id}: ${action==='power'?'power':action+' target temperature'}`);
  if(action==='power'){const on=snapshot.status==='connected'&&!!entity&&!['off','unknown','unavailable'].includes(entity.state);button.setAttribute('aria-pressed',on);button.title=on?'Turn off':'Turn on';button.setAttribute('aria-label',`${entity?.name||title||id}: ${button.title}`)}
  button.disabled=snapshot.status!=='connected'||!!pending;
  try{const cmd=climateCommand(entity,action);if(action!=='power'&&cmd.service_data.temperature===entity.temperature)button.disabled=true}catch{button.disabled=true}
  button.onclick=async event=>{
   event.stopPropagation();const marker={};climatePending.set(id,marker);notify('');renderRooms();
   try{await homeAssistant.setClimate(id,action);notify('Climate command sent. Waiting for the device to report its state.');
    if(climatePending.get(id)!==marker)return;
    marker.timer=setTimeout(()=>{if(climatePending.get(id)===marker){climatePending.delete(id);notify('Climate state has not confirmed yet. Check the device before trying again.');renderRooms()}},15000);
   }catch(error){climatePending.delete(id);notify(error.message);renderRooms()}
  };buttons.append(button);
 }
 card.append(buttons);container.append(card);
}
function renderCentral(){climatePanel.replaceChildren();climatePanel.hidden=!['upper','lower'].includes(activeView);if(!climatePanel.hidden)appendClimate(climatePanel,CENTRAL_CLIMATE,'Central climate')}

const optimistic=new OptimisticControls((...args)=>homeAssistant.setEntity(...args),message=>{
 snapshot=optimistic.project();if(message)notify(message);renderRooms();updateVisuals();
});
function controlEntity(id,brightness){
 const entity=snapshot.entities.find(e=>e.id===id);if(!entity)return;
 notify('');optimistic.set(id,entity.state!=='on',brightness);
}
function visibleDevices(room){return [...room.entities,...(room.fans||[])].filter(id=>{const entity=snapshot.entities.find(e=>e.id===id);return !!entity&&!entity.members?.length})}
let adjustingBrightness=false,brightnessDraft=null;
function appendDeviceControl(container,id,title){
 const entity=snapshot.entities.find(e=>e.id===id);if(!entity)return;
 const row=document.createElement('div');row.className='light-control';
 const head=document.createElement('div');head.className='room-head';
 if(title){const name=document.createElement('span');name.className='room-name';name.textContent=title;head.append(name)}
 const toggle=deviceButton(id);toggle.className='toggle'+(entity.state==='on'?' on':'');toggle.textContent='';head.append(toggle);row.append(head);
 if(entity.dimmable){
  const slider=document.createElement('input');slider.type='range';slider.dataset.entity=id;slider.min=0;slider.max=100;slider.step=1;slider.value=entity.state==='off'?0:Math.round((entity.brightness??255)/255*100);slider.disabled=toggle.disabled;slider.setAttribute('aria-label',`${entity.name} brightness`);slider.title=`${slider.value}%`;
  slider.onclick=e=>e.stopPropagation();slider.oninput=()=>{adjustingBrightness=true;brightnessDraft={id,value:Number(slider.value)};slider.title=`${slider.value}%`;updateVisuals()};
  slider.onchange=()=>{adjustingBrightness=false;brightnessDraft=null;controlEntity(id,Number(slider.value))};slider.onblur=()=>{if(adjustingBrightness){adjustingBrightness=false;brightnessDraft=null;renderRooms();updateVisuals()}};row.append(slider);
 }
 container.append(row);return toggle;
}
function deviceButton(id,icon=false){
 const entity=snapshot.entities.find(e=>e.id===id),button=document.createElement('button');
 const name=entity?.name||id.replace(/^(light|switch|fan)\./,'').replaceAll('_',' ');
 const on=entity?.state==='on';button.className=(icon?'room-bulb':'device-toggle')+(on?' on':'');
 button.textContent=icon?(id.startsWith('fan.')?'✣':'☀'):`${name} · ${optimistic.intents.has(id)?'Updating…':entity?.state||'unavailable'}`;
 button.title=`${name}: ${optimistic.intents.has(id)?'updating':entity?.state||'unavailable'}`;
 button.setAttribute('aria-label',`Turn ${on?'off':'on'} ${name}`);button.setAttribute('aria-pressed',on);
 button.disabled=snapshot.status!=='connected'||!['on','off'].includes(entity?.state)||!!entity?.members?.length;
 button.onclick=e=>{e.stopPropagation();controlEntity(id)};return button;
}
function renderLabels(){
 labelLayer.replaceChildren();roomLabels=[];
 for(const room of rooms.filter(r=>visibleOnFloor(r,activeView,true))){
  const devices=visibleDevices(room);
  const button=document.createElement('span');button.className='room-label passive';button.textContent=room.name;appendTemperature(button,room.id);
  const bulbs=document.createElement('div');bulbs.className='room-bulbs';
  for(const id of devices){
   const item=document.createElement('div');item.className='room-device';const bulb=deviceButton(id,true);item.append(bulb);
   if(devices.length>1){const label=document.createElement('span');label.textContent=snapshot.entities.find(e=>e.id===id)?.name||id.replace(/^(light|switch|fan)\./,'').replaceAll('_',' ');item.append(label)}
   bulbs.append(item);
  }
  const wrapper=document.createElement('div');wrapper.className='room-marker';wrapper.append(button);if(roomClimates[room.id])appendClimate(wrapper,roomClimates[room.id]);if(bulbs.childElementCount)wrapper.append(bulbs);labelLayer.append(wrapper);roomLabels.push({room,button:wrapper});
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
 const visualSnapshot=brightnessDraft?{...snapshot,entities:snapshot.entities.map(e=>e.id===brightnessDraft.id?{...e,state:brightnessDraft.value>0?'on':'off',brightness:Math.round(brightnessDraft.value*255/100)}:e)}:snapshot;
 uniforms.roomCount.value=rooms.length;
 rooms.forEach((room,i)=>{uniforms.roomMin.value[i].fromArray(room.min);uniforms.roomMax.value[i].fromArray(room.max);const state=roomState(room,mode,visualSnapshot);uniforms.roomLevel.value[i]=state.level===null?-1:state.level;const points=footprintOf(room);uniforms.roomVertexCount.value[i]=points.length;points.forEach((p,j)=>uniforms.roomPoints.value[i*MAX_VERTICES+j].fromArray(p))});

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
function setView(route){
 const view=route.floor;activeView=view;
 adjustingBrightness=false;brightnessDraft=null;
 document.title=`${route.label} · Nathan’s Home`;
 for(const link of $('view-links').querySelectorAll('a')){
  const selected=link.dataset.view===route.id;link.classList.toggle('active',selected);
  if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
 }
 renderer.clippingPlanes=['all','outside'].includes(view)?[]:view==='upper'?[new THREE.Plane(new THREE.Vector3(0,1,0),.15)]:[new THREE.Plane(new THREE.Vector3(0,-1,0),-.15)];
 renderer.domElement.hidden=view==='outside';$('outside-view').hidden=view!=='outside';
 $('show-labels').closest('label').hidden=view==='outside';
 document.querySelector('.view-caption').hidden=view==='outside';
 if(route.camera==='orbit')orbit();else if(route.camera==='top')top();
 renderRooms();updateVisuals();
}
for(const route of views){
 const link=document.createElement('a');link.className='button';link.dataset.view=route.id;
 link.href=routeURL(route,baseURL,location.href).href;link.textContent=route.label;
 link.onclick=event=>{if(!shouldHandleLink(event))return;event.preventDefault();router.navigate(route.id)};
 $('view-links').append(link);
}
$('aerial-photo').onerror=()=>{$('aerial-error').hidden=false};
function renderOutside(){
 $('outdoor-markers').replaceChildren();
 const garage=document.createElement('div');garage.className='room';appendTemperature(garage,'garage');appendClimate(garage,roomClimates.garage,'Garage heater');$('rooms').append(garage);
 const positions={'light.deck_light':[83,74],'light.backyard_cam_floodlight':[87,28],'light.front_door':[38,53],'light.garage':[42,75]};
 for(const [id,name] of outdoorLights){
  const card=document.createElement('div');card.className='room';const head=document.createElement('div');head.className='room-head';const heading=document.createElement('span');heading.className='room-name';heading.textContent=name;head.append(heading);card.append(head);
  if(snapshot.entities.some(e=>e.id===id)){
   const holder=document.createElement('div');const toggle=appendDeviceControl(holder,id);head.append(toggle);const slider=holder.querySelector('input');if(slider)card.append(slider);const marker=deviceButton(id);marker.classList.add('outdoor-marker');marker.textContent=`☀ ${name}`;marker.style.left=positions[id][0]+'%';marker.style.top=positions[id][1]+'%';$('outdoor-markers').append(marker);
  }
  else {const note=document.createElement('p');note.className='note';note.textContent=snapshot.status==='connected'?'Device not found.':'Waiting for Home Assistant connection.';card.append(note)}
  $('rooms').append(card);
 }
}
function renderRooms(){
 if(adjustingBrightness)return;
 const focused=document.activeElement?.dataset?.entity;
 const climateFocus=document.activeElement?.dataset?.climate;
 $('rooms').replaceChildren();renderLabels();renderCentral();
 $('room-section-title').textContent=activeView==='outside'?'Outside':'Rooms';
 if(activeView==='outside'){renderOutside();restoreSliderFocus(focused);restoreClimateFocus(climateFocus);return}

 const primaryIDs=new Set(['primary-bedroom','primary-closet','primary-bath']);
 let primaryGroup=null;
 for(const room of rooms.filter(r=>visibleOnFloor(r,activeView))){
  const devices=visibleDevices(room);
  const card=document.createElement('div');card.className='room';
  const head=document.createElement('div');head.className='room-head';const text=document.createElement('div'),title=document.createElement('span');title.className='room-name';title.textContent=room.id==='primary-bath'?'Primary Vanity / Bath':room.name;text.append(title);head.append(text);
  appendTemperature(text,room.id);card.append(head);
  if(roomClimates[room.id])appendClimate(card,roomClimates[room.id]);
  if(devices.length===1){
   const holder=document.createElement('div');const toggle=appendDeviceControl(holder,devices[0]);
   head.append(toggle);const slider=holder.querySelector('input');if(slider)card.append(slider);
  }else for(const id of devices)appendDeviceControl(card,id,snapshot.entities.find(e=>e.id===id)?.name||id);
  if(primaryIDs.has(room.id)){
   if(!primaryGroup){primaryGroup=document.createElement('section');primaryGroup.className='primary-group';primaryGroup.setAttribute('aria-label','Primary lights');const heading=document.createElement('h3');heading.textContent='Primary lights';primaryGroup.append(heading);$('rooms').append(primaryGroup)}
   primaryGroup.append(card);
  }else $('rooms').append(card);
 }
 restoreSliderFocus(focused);restoreClimateFocus(climateFocus);
}
function restoreClimateFocus(key){if(key)for(const button of document.querySelectorAll('[data-climate]'))if(button.dataset.climate===key){button.focus({preventScroll:true});break}}
function restoreSliderFocus(id){if(id)for(const slider of $('rooms').querySelectorAll('input[type=range]'))if(slider.dataset.entity===id)slider.focus({preventScroll:true})}
const labels={not_configured:'Disconnected · no saved token',connecting:'Connecting to your home',connected:'Your home is connected',auth_failed:'Token rejected · open settings',disconnected:'Home offline · reconnecting',permission_denied:'Home Assistant denied access',connection_error:'Connection failed · open settings',protocol_error:'Connection error · open settings'};
function receiveState(next){for(const [id,pending] of climatePending){const before=snapshot.entities.find(e=>e.id===id),after=next.entities.find(e=>e.id===id);if(next.status!=='connected'||before?.state!==after?.state||before?.temperature!==after?.temperature){clearTimeout(pending.timer);climatePending.delete(id)}}if(next.status!=='connected'){adjustingBrightness=false;brightnessDraft=null;}snapshot=optimistic.reconcile(next);$('mode-note').textContent=next.status==='connected'?'':next.status==='not_configured'?'Connect Home Assistant in settings to control your lights and climate.':'Controls reconnect automatically.';if($('setup').open&&snapshot.status!=='not_configured')$('connection-result').textContent=labels[snapshot.status]||snapshot.status;const indicator=$('connection'),description=labels[snapshot.status]||snapshot.status;indicator.dataset.state=snapshot.status==='connected'?'connected':['connecting','disconnected'].includes(snapshot.status)?'connecting':'disconnected';indicator.title=description;indicator.setAttribute('aria-label',description);renderRooms();updateVisuals()}
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
const router=createRouter({routes:views,baseURL,onRoute:setView});
restoreConnection();
renderRooms();updateVisuals();renderer.setAnimationLoop(()=>{controls.update();positionLabels();renderer.render(scene,camera)});
