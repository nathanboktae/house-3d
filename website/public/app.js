import {teslaStatus} from './tesla.mjs?v=rollo1';
import {outdoorCameras,findCamera,cameraStreamURL} from './cameras.mjs';
import {loadRuntime,ingressConnection} from './runtime.mjs';
import {roomTemperatures,roomClimates,CENTRAL_CLIMATE,roomTemperature,formatTemperature,climateCommand} from './climate.mjs?v=roomtemps2';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {defaults,roomState,MAX_ROOMS,MAX_VERTICES,footprintOf,visibleOnFloor} from './rooms.mjs?v=sharedchandeliers1';
import {HomeAssistant,DEFAULT_HA_URL,TOKEN_KEY,URL_KEY,loadConnection,saveConnection,forgetConnection,normalizeURL,testConnection} from './ha.mjs?v=rollo1';
import {OptimisticControls} from './optimistic.mjs?v=1';
import {createRouter,routeURL,shouldHandleLink} from './router.mjs?v=1';
const tvMode=['1','true',''].includes(new URLSearchParams(location.search).get('tv'));
document.body.classList.toggle('tv-mode',tvMode);
const baseURL=new URL('.',import.meta.url);
// Keep relative assets anchored when pushState changes the document URL.
document.querySelector('base').href=baseURL.href;
let runtime;
try{runtime=await loadRuntime(baseURL)}catch{document.getElementById('loading').textContent='Could not load app settings. Reload to retry.';throw Error('App settings unavailable');}
const views=await fetch(new URL('./views.json',baseURL)).then(response=>{if(!response.ok)throw Error('Could not load view routes.');return response.json()});
const $=id=>document.getElementById(id),stage=$('stage');
const rooms=structuredClone(defaults),mode='live';
let snapshot={status:'not_configured',entities:[]},model=null;
function notify(text){$('notice').textContent=text}
const scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0,0);stage.append(renderer.domElement);
const camera=new THREE.PerspectiveCamera(38,1,.1,200),controls=new OrbitControls(camera,renderer.domElement);controls.enabled=!tvMode;controls.enableDamping=!tvMode;controls.minDistance=4;controls.maxDistance=65;controls.maxPolarAngle=Math.PI*.92;
let activeView='all';
const cameraPanels=new Map();
const center=new THREE.Vector3(4.4,1.2,-2.3);
function orbit(){camera.up.set(0,1,0);camera.position.copy(center).add(new THREE.Vector3(17,16,17));controls.target.copy(center);controls.enableRotate=true;controls.update()}
const tvFloorBounds=new Map();
function fitTVFloor(){
 if(!tvMode||!model||!['upper','lower'].includes(activeView))return;
 let bounds=tvFloorBounds.get(activeView);
 if(!bounds){
  bounds=new THREE.Box3();const point=new THREE.Vector3();
  model.updateMatrixWorld(true);
  model.traverse(object=>{
   if(!object.isMesh)return;
   const positions=object.geometry.getAttribute('position');
   for(let i=0;i<positions.count;i++){
    point.fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld);
    if(activeView==='upper'?point.y>=-.15:point.y<=-.15)bounds.expandByPoint(point);
   }
  });
  if(bounds.isEmpty())return;
  tvFloorBounds.set(activeView,bounds);
 }
 const midpoint=bounds.getCenter(new THREE.Vector3());
 // Fit both axes into 84% of the viewport: 8% clear space on each edge.
 const tangent=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
 let elevation=bounds.max.y+camera.near;
 const point=new THREE.Vector3();
 model.traverse(object=>{
  if(!object.isMesh)return;
  const positions=object.geometry.getAttribute('position');
  for(let i=0;i<positions.count;i++){
   point.fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld);
   if(activeView==='upper'?point.y<-.15:point.y>-.15)continue;
   elevation=Math.max(elevation,point.y+Math.max(Math.abs(point.x-midpoint.x)/camera.aspect,Math.abs(point.z-midpoint.z))/(tangent*.84));
  }
 });
 controls.target.copy(midpoint);
 camera.up.set(0,0,-1);
 camera.position.set(midpoint.x,elevation,midpoint.z);
 camera.lookAt(midpoint);
 controls.update();
}
function top(){camera.up.set(0,0,-1);camera.position.copy(center).add(new THREE.Vector3(0,23,.001));controls.target.copy(center);controls.enableRotate=false;controls.update();fitTVFloor()}
new ResizeObserver(()=>{const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();fitTVFloor()}).observe(stage);
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
  button.disabled=tvMode||snapshot.status!=='connected'||!!pending;
  try{const cmd=climateCommand(entity,action);if(action!=='power'&&cmd.service_data.temperature===entity.temperature)button.disabled=true}catch{button.disabled=true}
  button.onclick=async event=>{
   event.stopPropagation();if(tvMode)return;const marker={};climatePending.set(id,marker);notify('');renderRooms();
   try{await homeAssistant.setClimate(id,action);notify('Climate command sent. Waiting for the device to report its state.');
    if(climatePending.get(id)!==marker)return;
    marker.timer=setTimeout(()=>{if(climatePending.get(id)===marker){climatePending.delete(id);notify('Climate state has not confirmed yet. Check the device before trying again.');renderRooms()}},15000);
   }catch(error){climatePending.delete(id);notify(error.message);renderRooms()}
  };buttons.append(button);
 }
 card.append(buttons);container.append(card);
}
function renderCentral(){climatePanel.replaceChildren();climatePanel.hidden=!['all','upper','lower'].includes(activeView);if(!climatePanel.hidden)appendClimate(climatePanel,CENTRAL_CLIMATE,'Central climate')}

const optimistic=new OptimisticControls((...args)=>homeAssistant.setEntity(...args),message=>{
 snapshot=optimistic.project();if(message)notify(message);renderRooms();updateVisuals();
});
function controlEntity(id,brightness){
 if(tvMode)return;
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
 const button=document.createElement('button');
 button.onclick=e=>{e.stopPropagation();controlEntity(id)};
 updateDeviceButton(button,id,icon);return button;
}
function updateDeviceButton(button,id,icon=false){
 const entity=snapshot.entities.find(e=>e.id===id);
 const name=entity?.name||id.replace(/^(light|switch|fan)\./,'').replaceAll('_',' ');
 const on=entity?.state==='on';button.className=(icon?'room-bulb':'device-toggle')+(on?' on':'');
 const text=icon?(id.startsWith('fan.')?'✣':'☀'):`${name} · ${optimistic.intents.has(id)?'Updating…':entity?.state||'unavailable'}`;
 if(button.textContent!==text)button.textContent=text;
 button.title=`${name}: ${optimistic.intents.has(id)?'updating':entity?.state||'unavailable'}`;
 button.setAttribute('aria-label',`Turn ${on?'off':'on'} ${name}`);button.setAttribute('aria-pressed',on);
 button.disabled=tvMode||snapshot.status!=='connected'||!['on','off'].includes(entity?.state)||!!entity?.members?.length;
}
const roomMarkerCache=new Map();
function renderLabels(){
 // Keep marker/button nodes mounted through HA updates so hover and focus survive.
 const visible=rooms.filter(r=>visibleOnFloor(r,activeView,true));
 const visibleIDs=new Set(visible.map(room=>room.id));
 for(const [id,marker] of roomMarkerCache)if(!visibleIDs.has(id)){marker.wrapper.remove();roomMarkerCache.delete(id)}
 roomLabels=[];
 for(const room of visible){
  let marker=roomMarkerCache.get(room.id);
  if(!marker){
   const wrapper=document.createElement('div');wrapper.className='room-marker';
   const label=document.createElement('span');label.className='room-label passive';label.append(document.createTextNode(room.name));
   const temperature=document.createElement('span');temperature.className='room-temperature';temperature.title='Room temperature';label.append(temperature);
   const climate=document.createElement('div');climate.style.display='contents';
   const bulbs=document.createElement('div');bulbs.className='room-bulbs';wrapper.append(label,climate,bulbs);labelLayer.append(wrapper);
   marker={wrapper,temperature,climate,bulbs,devices:new Map()};roomMarkerCache.set(room.id,marker);
  }
  const reading=roomTemperature(room.id,snapshot);marker.temperature.hidden=reading===null;
  if(marker.temperature.textContent!==(reading||''))marker.temperature.textContent=reading||'';
  const climateID=roomClimates[room.id];
  const climateKey=JSON.stringify([snapshot.status,snapshot.entities.find(e=>e.id===climateID),climatePending.has(climateID)]);
  if(climateID&&marker.climateKey!==climateKey){marker.climate.replaceChildren();appendClimate(marker.climate,climateID);marker.climateKey=climateKey}
  const devices=visibleDevices(room);
  for(const [id,device] of marker.devices)if(!devices.includes(id)){device.item.remove();marker.devices.delete(id)}
  for(const id of devices){
   let device=marker.devices.get(id);
   if(!device){
    const item=document.createElement('div');item.className='room-device';const bulb=deviceButton(id,true),label=document.createElement('span');item.append(bulb,label);marker.bulbs.append(item);
    device={item,bulb,label};marker.devices.set(id,device);
   }
   updateDeviceButton(device.bulb,id,true);
   device.label.hidden=devices.length<=1;
   const name=snapshot.entities.find(e=>e.id===id)?.name||id.replace(/^(light|switch|fan)\./,'').replaceAll('_',' ');
   if(device.label.textContent!==name)device.label.textContent=name;
  }
  marker.bulbs.hidden=!devices.length;
  roomLabels.push({room,button:marker.wrapper});
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
   float roomEdgeDistance(int room,vec2 p){
    float distanceToEdge=10000.0;
    int count=roomVertexCount[room];
    vec2 previous=roomPoints[room*${MAX_VERTICES}+count-1];
    for(int v=0;v<${MAX_VERTICES};v++){
     if(v>=count)break;
     vec2 current=roomPoints[room*${MAX_VERTICES}+v];
     vec2 segment=current-previous;
     float t=clamp(dot(p-previous,segment)/max(dot(segment,segment),0.000001),0.0,1.0);
     distanceToEdge=min(distanceToEdge,length(p-(previous+t*segment)));
     previous=current;
    }
    return distanceToEdge;
   }
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
    vec3 roomMultiplier=vec3(1.0);
    float strongestMask=0.0;
    for(int room=0;room<${MAX_ROOMS};room++){
      if(room>=roomCount) break;
      if(roomLevel[room]<0.0) continue;
      vec3 outside=max(roomMin[room]-housePosition,housePosition-roomMax[room]);
      float edge=max(outside.x,max(outside.y,outside.z));
      if(edge>0.0 || !insideRoom(room,housePosition.xz))continue;
      // Feather approximate room footprints instead of drawing hard rectangles.
      float mask=smoothstep(0.0,0.12,roomEdgeDistance(room,housePosition.xz));
      float power=mix(0.18,1.12,roomLevel[room]);
      vec3 tint=mix(vec3(0.76,0.85,1.0),vec3(1.0,0.96,0.86),roomLevel[room]);
      // Overlapping footprints must not dim the same surface twice.
      if(mask>strongestMask){roomMultiplier=mix(vec3(1.0),power*tint,mask);strongestMask=mask;}
    }
    outgoingLight*=roomMultiplier;
    #include <opaque_fragment>`);
  };
  material.customProgramCacheKey=()=> 'house-room-polygons-v3';material.needsUpdate=true;
 })});$('loading').hidden=true;fitTVFloor();updateVisuals();
},event=>{if(event.total)$('loading').textContent=`Loading Nathan’s home… ${Math.round(event.loaded/event.total*100)}%`},()=>{$('loading').textContent='Could not load the model. Check that the deployed site includes model/house.glb.'});
function setView(route){
 const view=route.floor;activeView=view;
 document.body.classList.toggle('outside-active',view==='outside');
 if(view!=='outside'&&!tvMode)stopCameras();
 if(tvMode)$('tv-title').textContent=view==='outside'?'Garage':route.label;
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
function stopCameras(){
 for(const panel of cameraPanels.values()){clearTimeout(panel.timer);panel.image.removeAttribute('src');panel.image.hidden=true;}
}
function appendTesla(container){
 const {battery,charging,label}=teslaStatus(snapshot);
 const row=document.createElement('div');row.className='tesla-status';
 const name=document.createElement('span');name.className='tesla-name';name.textContent='Rollo';
 const reading=document.createElement('strong');reading.textContent=battery===null?'Unavailable':`${battery}%`;reading.setAttribute('aria-label',`Rollo battery: ${reading.textContent}`);
 row.append(name,reading);
 const status=document.createElement('span');status.className='tesla-charging'+(charging?' is-charging':'');status.title=label;
 if(charging){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0V8Zm6 9v4');svg.append(path);status.append(svg);
 }
 status.append(document.createTextNode(label));row.append(status);container.append(row);
}
function renderOutside(){
 for(const config of outdoorCameras){
  let panel=cameraPanels.get(config.key);
  if(!panel){
   const card=document.createElement('section');card.className=`camera-card camera-${config.key}`;
   const heading=document.createElement('h3');heading.textContent=config.name;
   const header=document.createElement('div');header.className='camera-heading';
   const select=document.createElement('select');select.setAttribute('aria-label',`${config.name} camera source`);
   let selected='';try{selected=localStorage.getItem(`outside-camera:${config.key}`)||''}catch{}
   select.onchange=()=>{panel.selected=select.value;try{localStorage.setItem(`outside-camera:${config.key}`,select.value)}catch{}renderOutside()};
   header.append(heading,select);card.append(header);
   const frame=document.createElement('div');frame.className='camera-frame';
   const image=document.createElement('img');image.alt=`${config.name} camera feed`;image.loading='eager';image.referrerPolicy='no-referrer';image.hidden=true;
   const status=document.createElement('p');status.className='camera-status';status.setAttribute('role','status');
   const retry=document.createElement('button');retry.disabled=tvMode;retry.textContent='Retry feed';retry.hidden=true;
   retry.onclick=()=>{image.removeAttribute('src');renderOutside()};
   image.onload=()=>{clearTimeout(panel.timer);image.hidden=false;status.hidden=true;retry.hidden=true};
   image.onerror=()=>{clearTimeout(panel.timer);image.hidden=true;status.hidden=false;status.textContent='Camera feed unavailable.';retry.hidden=false;if(tvMode&&!document.hidden)panel.timer=setTimeout(()=>{image.removeAttribute('src');renderOutside()},10000)};
   frame.append(image,status,retry);card.append(frame);
   const controls=document.createElement('div');controls.className='camera-controls';if(config.lights.length)card.append(controls);
   $('camera-grid').append(card);panel={image,status,retry,controls,select,selected};cameraPanels.set(config.key,panel);
  }
  const {image,status,retry,controls,select}=panel;
  const cameras=snapshot.entities.filter(entity=>entity.id.startsWith('camera.'));
  const values=['',...cameras.map(entity=>entity.id)];
  if(JSON.stringify(values)!==select.dataset.options){
   select.replaceChildren();
   for(const id of values){const option=document.createElement('option');option.value=id;option.textContent=id?`${cameras.find(entity=>entity.id===id).name} (${id})`:'Auto-detect camera';select.append(option)}
   select.dataset.options=JSON.stringify(values);
  }
  select.value=panel.selected;select.disabled=tvMode||snapshot.status!=='connected';
  const entity=panel.selected?cameras.find(entity=>entity.id===panel.selected):findCamera(snapshot.entities,config);
  select.hidden=!!entity;
  const source=(tvMode||activeView==='outside')&&!document.hidden&&snapshot.status==='connected'?cameraStreamURL(entity,homeAssistant.config):null;
  if(source){
   if(image.getAttribute('src')!==source){status.hidden=false;status.textContent='Connecting camera…';retry.hidden=true;clearTimeout(panel.timer);panel.timer=setTimeout(()=>{status.hidden=false;status.textContent='Camera is taking longer to connect.';retry.hidden=false},30000);image.src=source;image.hidden=false;}
  }else{
   clearTimeout(panel.timer);image.removeAttribute('src');image.hidden=true;status.hidden=false;retry.hidden=true;
   status.textContent=snapshot.status!=='connected'?'Waiting for Home Assistant connection.':!entity?'Choose a camera above.':document.hidden?'Camera paused.':'Camera unavailable.';
  }
  controls.replaceChildren();
  for(const [id,title] of config.lights){
   if(snapshot.entities.some(e=>e.id===id))appendDeviceControl(controls,id,title);
   else{const label=document.createElement('p');label.className='note';label.textContent=`${title} · unavailable`;controls.append(label)}
  }
  if(config.key==='garage'){appendTemperature(controls,'garage');appendClimate(controls,roomClimates.garage,'Garage heater');appendTesla(controls)}
 }
}
addEventListener('visibilitychange',()=>{if(document.hidden)stopCameras();else if(tvMode||activeView==='outside')renderOutside()});
function renderRooms(){
 if(adjustingBrightness)return;
 const focused=document.activeElement?.dataset?.entity;
 const climateFocus=document.activeElement?.dataset?.climate;
 $('rooms').replaceChildren();renderLabels();renderCentral();
 $('room-section-title').textContent=activeView==='outside'?'Outside':'Rooms';
 if(tvMode||activeView==='outside')renderOutside();
 if(activeView==='outside'){restoreSliderFocus(focused);restoreClimateFocus(climateFocus);return}

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
function restoreSliderFocus(id){if(id)for(const slider of document.querySelectorAll('input[type=range]'))if(slider.dataset.entity===id)slider.focus({preventScroll:true})}
const labels={not_configured:'Disconnected · no saved token',connecting:'Connecting to your home',connected:'Your home is connected',auth_failed:'Token rejected · open settings',disconnected:'Home offline · reconnecting',permission_denied:'Home Assistant denied access',connection_error:'Connection failed · open settings',protocol_error:'Connection error · open settings'};
function receiveState(next){for(const [id,pending] of climatePending){const before=snapshot.entities.find(e=>e.id===id),after=next.entities.find(e=>e.id===id);if(next.status!=='connected'||before?.state!==after?.state||before?.temperature!==after?.temperature){clearTimeout(pending.timer);climatePending.delete(id)}}if(next.status!=='connected'){adjustingBrightness=false;brightnessDraft=null;}snapshot=optimistic.reconcile(next);$('mode-note').textContent=next.status==='connected'?'':next.status==='not_configured'?'Connect Home Assistant in settings to control your lights and climate.':'Controls reconnect automatically.';if($('setup').open&&snapshot.status!=='not_configured')$('connection-result').textContent=labels[snapshot.status]||snapshot.status;const indicator=$('connection'),description=labels[snapshot.status]||snapshot.status;if(tvMode)$('tv-status').textContent=snapshot.status==='connected'?'':description;indicator.dataset.state=snapshot.status==='connected'?'connected':['connecting','disconnected'].includes(snapshot.status)?'connecting':'disconnected';indicator.title=description;indicator.setAttribute('aria-label',description);renderRooms();updateVisuals()}
const homeAssistant=new HomeAssistant(receiveState);
function restoreConnection(){
 try{
  const config=runtime.mode==='ingress'?ingressConnection(baseURL):loadConnection(localStorage);
  homeAssistant.start(config);
 }catch{homeAssistant.stop();notify('Browser storage is unavailable or the saved connection is invalid. Open Home Assistant settings.')}
}
function refreshSettings(){
 try{const saved=loadConnection(localStorage);$('ha-url').value=saved.url;$('ha-token').value='';$('ha-token').placeholder=saved.token?'Token saved · leave blank to keep it':'Paste a long-lived access token';$('token-state').textContent=saved.token?'A token is saved in this browser.':'No token saved yet.'}
 catch{$('ha-url').value=DEFAULT_HA_URL;$('token-state').textContent='Browser storage is unavailable.'}
}
if(runtime.mode==='ingress'){$('help').hidden=true;}
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
addEventListener('storage',event=>{if(runtime.mode!=='ingress'&&(event.key===null||[TOKEN_KEY,URL_KEY].includes(event.key)))restoreConnection()});
addEventListener('pagehide',()=>{stopCameras();homeAssistant.stop()});
addEventListener('pageshow',event=>{if(event.persisted)restoreConnection()});
if(runtime.mode==='ingress'&&views.some(view=>view.slug===runtime.defaultView)&&[baseURL.pathname,baseURL.pathname+'index.html'].includes(location.pathname)){history.replaceState(null,'',routeURL(views.find(view=>view.slug===runtime.defaultView),baseURL,location.href));}
// TV rotation stays out of browser history and keeps the bookmarked URL stable.
let router;
if(tvMode){
 const sequence=['upper','lower','outside'].map(id=>views.find(view=>view.id===id));
 let index=0;
 setView(sequence[index]);
 setInterval(()=>{
  if(document.hidden)return;
  stage.classList.add('tv-fading');
  setTimeout(()=>{
   index=(index+1)%sequence.length;setView(sequence[index]);
   stage.classList.remove('tv-fading');
  },350);
 },12000);
}else router=createRouter({routes:views,baseURL,onRoute:setView});
restoreConnection();
renderRooms();updateVisuals();renderer.setAnimationLoop(()=>{controls.update();positionLabels();renderer.render(scene,camera)});
