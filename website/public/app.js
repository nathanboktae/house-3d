import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {defaults,validateRooms,roomState,MAX_ROOMS,MAX_VERTICES,ROOM_STORAGE_KEY,loadRoomMap,footprintOf,visibleOnFloor,resizeRoom} from './rooms.mjs';
import {HomeAssistant,DEFAULT_HA_URL,TOKEN_KEY,URL_KEY,loadConnection,saveConnection,forgetConnection,normalizeURL,testConnection} from './ha.mjs';
const $=id=>document.getElementById(id),stage=$('stage');
let rooms=structuredClone(defaults),selected=rooms[0].id,mode='demo',snapshot={status:'not_configured',entities:[]},drawStart=null,drawing=false,model=null;
try{const loaded=loadRoomMap(localStorage);rooms=loaded.rooms;selected=rooms[0]?.id;if(loaded.preserved)notify('Your custom map was preserved. Use “Use labeled room map” below to load the confirmed rooms.')}catch{notify('Saved mapping could not be read. Using the confirmed room map.')}
function notify(text){$('notice').textContent=text}
function save(){try{validateRooms(rooms);localStorage.setItem(ROOM_STORAGE_KEY,JSON.stringify(rooms))}catch(e){notify(e.message)}}
const scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0,0);stage.append(renderer.domElement);
const camera=new THREE.PerspectiveCamera(38,1,.1,200),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=4;controls.maxDistance=65;controls.maxPolarAngle=Math.PI*.92;
const center=new THREE.Vector3(4.4,1.2,-2.3);
function orbit(){camera.up.set(0,1,0);camera.position.copy(center).add(new THREE.Vector3(17,16,17));controls.target.copy(center);controls.enableRotate=true;controls.update();$('orbit').classList.add('active');$('top').classList.remove('active')}
function top(){camera.up.set(0,0,-1);camera.position.copy(center).add(new THREE.Vector3(0,23,.001));controls.target.copy(center);controls.enableRotate=false;controls.update();$('top').classList.add('active');$('orbit').classList.remove('active')}
$('orbit').onclick=()=>{cancelDraw();orbit()};$('top').onclick=top;orbit();
new ResizeObserver(()=>{const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix()}).observe(stage);
const uniforms={roomMin:{value:Array.from({length:MAX_ROOMS},()=>new THREE.Vector3())},roomMax:{value:Array.from({length:MAX_ROOMS},()=>new THREE.Vector3())},roomLevel:{value:Array(MAX_ROOMS).fill(-1)},roomCount:{value:0},roomVertexCount:{value:Array(MAX_ROOMS).fill(0)},roomPoints:{value:Array.from({length:MAX_ROOMS*MAX_VERTICES},()=>new THREE.Vector2())}};
const box=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xe8bc7a}));box.visible=false;scene.add(box);
const labelLayer=document.createElement('div');labelLayer.className='room-labels';stage.append(labelLayer);
let roomLabels=[];
function selectRoom(id){selected=id;renderRooms();renderEditor();updateVisuals()}
function renderLabels(){
 labelLayer.replaceChildren();roomLabels=[];
 for(const room of rooms.filter(r=>visibleOnFloor(r,$('floor').value,true))){
  const button=document.createElement('button');button.className='room-label'+(room.id===selected?' selected':'');button.textContent=room.name;button.onclick=()=>selectRoom(room.id);labelLayer.append(button);roomLabels.push({room,button});
 }
}
function positionLabels(){
 labelLayer.hidden=drawing||!$('show-labels').checked;
 const occupied=[];
 for(const {room,button} of roomLabels){
  const anchor=room.labelPosition?[...room.labelPosition]:[(room.min[0]+room.max[0])/2,room.min[1]+.15,(room.min[2]+room.max[2])/2];
  if(room.floor==='both')anchor[1]=$('floor').value==='lower'?-2.5:0;
  const p=new THREE.Vector3(...anchor).project(camera);
  button.hidden=p.z < -1||p.z > 1||Math.abs(p.x)>1||Math.abs(p.y)>1;
  const x=(p.x+1)*stage.clientWidth/2,y=(1-p.y)*stage.clientHeight/2,w=button.offsetWidth,h=button.offsetHeight;
  let offset=0;
  for(const dy of [0,-h-5,h+5,-2*(h+5),2*(h+5)]){
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
 const r=rooms.find(r=>r.id===selected);box.visible=!!r&&$('editor').open&&visibleOnFloor(r,$('floor').value);
 if(r){const vertices=[],points=footprintOf(r);points.forEach(([x,z],i)=>{const [nx,nz]=points[(i+1)%points.length];for(const y of [r.min[1],r.max[1]])vertices.push(x,y,z,nx,y,nz);vertices.push(x,r.min[1],z,x,r.max[1],z)});box.geometry.dispose();box.geometry=new THREE.BufferGeometry();box.geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3))}
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
$('floor').onchange=()=>{
 const floor=$('floor').value;
 renderer.clippingPlanes=floor==='all'?[]:floor==='upper'?[new THREE.Plane(new THREE.Vector3(0,1,0),.15)]:[new THREE.Plane(new THREE.Vector3(0,-1,0),-.15)];
 renderRooms();updateVisuals();
};
function renderRooms(){
 $('rooms').replaceChildren();renderLabels();
 for(const room of rooms.filter(r=>visibleOnFloor(r,$('floor').value))){
  const state=roomState(room,mode,snapshot),card=document.createElement('div');card.className='room'+(selected===room.id?' selected':'');
  const head=document.createElement('div');head.className='room-head';const text=document.createElement('div'),title=document.createElement('span'),sub=document.createElement('small');title.className='room-name';title.textContent=room.name;sub.textContent=[room.references?.join('/'),state.label].filter(Boolean).join(' · ');text.append(title,sub);head.append(text);
  const button=document.createElement('button');button.className='toggle'+(state.level>0?' on':'');button.setAttribute('aria-label',`Toggle demo ${room.name}`);button.setAttribute('aria-pressed',state.level>0);button.disabled=mode==='live';button.onclick=e=>{e.stopPropagation();room.demo=room.demo>0?0:1;save();renderRooms();updateVisuals()};head.append(button);card.append(head);
  if(mode==='demo'){const slider=document.createElement('input');slider.type='range';slider.min=0;slider.max=100;slider.value=room.demo*100;slider.setAttribute('aria-label',`${room.name} demo brightness`);slider.onclick=e=>e.stopPropagation();slider.oninput=()=>{room.demo=+slider.value/100;sub.textContent=room.demo>0?'Demo · on':'Demo · off';button.classList.toggle('on',room.demo>0);button.setAttribute('aria-pressed',room.demo>0);updateVisuals()};slider.onchange=save;card.append(slider)}
  card.onclick=()=>selectRoom(room.id);$('rooms').append(card);
 }
 if(!rooms.length){const p=document.createElement('p');p.className='note';p.textContent='Add a room, draw its footprint, then try the lights.';$('rooms').append(p)}
 $('add').disabled=rooms.length>=MAX_ROOMS;
}
function renderEntities(){
 const room=rooms.find(r=>r.id===selected);$('entities').replaceChildren();
 if(!room)return;
 const available=new Map(snapshot.entities.map(e=>[e.id,e]));for(const id of room.entities)if(!available.has(id))available.set(id,{id,name:id,state:'unavailable'});
 for(const e of available.values()){const option=document.createElement('option');option.value=e.id;option.textContent=`${e.name} · ${e.state}`;option.selected=room.entities.includes(e.id);$('entities').append(option)}
 if(!available.size){const option=document.createElement('option');option.textContent='Connect Home Assistant to list lights';option.disabled=true;$('entities').append(option)}
}
function renderEditor(){
 const r=rooms.find(r=>r.id===selected);$('editor').hidden=!r;if(!r)return;
 $('room-name').value=r.name;$('bounds').replaceChildren();
 for(let axis=0;axis<3;axis++)for(const end of ['min','max']){
  const label=document.createElement('label');label.textContent=`${['X','Height (Y)','Z'][axis]} ${end}`;
  const input=document.createElement('input');input.type='number';input.step='.1';input.value=r[end][axis];input.onchange=()=>{
   const min=[...r.min],max=[...r.max];(end==='min'?min:max)[axis]=Number(input.value);try{const next=resizeRoom(r,min,max);rooms[rooms.indexOf(r)]=next;save();renderRooms();renderEditor();updateVisuals();notify('Room boundary saved.')}catch(e){input.value=r[end][axis];notify(e.message)}
  };label.append(input);$('bounds').append(label);
 }renderEntities();
}
$('room-name').onchange=()=>{const r=rooms.find(r=>r.id===selected);if(!r)return;const name=$('room-name').value.trim();if(!name){$('room-name').value=r.name;return}r.name=name;save();renderRooms()};
$('entities').onchange=()=>{const r=rooms.find(r=>r.id===selected);if(r){r.entities=[...$('entities').selectedOptions].map(o=>o.value);save();renderRooms();updateVisuals()}};
$('editor').ontoggle=updateVisuals;
$('add').onclick=()=>{if(rooms.length>=MAX_ROOMS)return;const lower=$('floor').value==='lower';const room={id:crypto.randomUUID(),name:'New room',min:[2,lower?-2.8:-.15,-3],max:[5,lower?-.15:5.8,0],entities:[],demo:1};rooms.push(room);selected=room.id;save();renderRooms();renderEditor();$('editor').open=true;updateVisuals();startDraw()};
$('delete').onclick=()=>{rooms=rooms.filter(r=>r.id!==selected);selected=rooms[0]?.id;cancelDraw();save();renderRooms();renderEditor();updateVisuals()};
function startDraw(){if(!selected)return;top();drawing=true;drawStart=null;controls.enabled=false;$('draw-hint').hidden=false;$('draw-hint').textContent='Click two opposite room corners. Esc cancels.'}
function cancelDraw(){drawing=false;drawStart=null;controls.enabled=true;$('draw-hint').hidden=true}
$('draw').onclick=startDraw;addEventListener('keydown',e=>{if(e.key==='Escape')cancelDraw()});
renderer.domElement.addEventListener('pointerdown',e=>{
 if(!drawing)return;
 const rect=renderer.domElement.getBoundingClientRect(),mouse=new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),ray=new THREE.Raycaster();ray.setFromCamera(mouse,camera);
 const r=rooms.find(r=>r.id===selected),hit=new THREE.Vector3();if(!r||!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-r.min[1]),hit))return;
 if(!drawStart){drawStart=hit.clone();$('draw-hint').textContent='Now click the opposite corner.';return}
 if(Math.abs(hit.x-drawStart.x)<.1||Math.abs(hit.z-drawStart.z)<.1){notify('Choose a larger room footprint.');return}
 for(const axis of [0,2]){r.min[axis]=Math.round(Math.min(hit.getComponent(axis),drawStart.getComponent(axis))*100)/100;r.max[axis]=Math.round(Math.max(hit.getComponent(axis),drawStart.getComponent(axis))*100)/100}
 delete r.footprint;delete r.labelPosition;cancelDraw();save();renderRooms();renderEditor();updateVisuals();notify('Footprint saved. Adjust height bounds if needed.');
});
function setMode(next){mode=next;$('demo').classList.toggle('active',mode==='demo');$('live').classList.toggle('active',mode==='live');$('mode-note').textContent=mode==='demo'?'Demo controls only change this view.':'Read-only live states. Unknown rooms keep their original appearance.';renderRooms();updateVisuals()}
$('demo').onclick=()=>setMode('demo');$('live').onclick=()=>setMode('live');
const labels={not_configured:'Demo · no saved token',connecting:'Connecting to your home',connected:'Your home is connected',auth_failed:'Token rejected · open settings',disconnected:'Home offline · reconnecting',permission_denied:'Home Assistant denied access',connection_error:'Connection failed · open settings',protocol_error:'Connection error · open settings'};
function receiveState(next){snapshot=next;if($('setup').open&&snapshot.status!=='not_configured')$('connection-result').textContent=labels[snapshot.status]||snapshot.status;$('connection').textContent=labels[snapshot.status]||snapshot.status;$('connection').classList.toggle('online',snapshot.status==='connected');renderRooms();if(document.activeElement!==$('entities'))renderEntities();updateVisuals()}
const homeAssistant=new HomeAssistant(receiveState);
function restoreConnection(){try{homeAssistant.start(loadConnection(localStorage))}catch{homeAssistant.stop();notify('Browser storage is unavailable or the saved connection is invalid. Open Home Assistant settings.')}}
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
  const config=saveConnection(localStorage,{url,token});homeAssistant.start(config);refreshSettings();setMode('live');$('connection-result').textContent='Saved in this browser. Connecting…';
 }catch(error){$('connection-result').textContent=error.message}
};
$('forget-token').onclick=()=>{
 homeAssistant.stop();
 try{forgetConnection(localStorage);refreshSettings();$('connection-result').textContent='Token removed from this browser. Revoke it in Home Assistant too if you no longer need it.';setMode('demo')}
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
$('reset-map').onclick=()=>{try{localStorage.setItem('house-live-rooms-backup',JSON.stringify(rooms));rooms=structuredClone(defaults);selected=rooms[0].id;save();renderRooms();renderEditor();updateVisuals();notify('Confirmed room map loaded. Previous map backed up in this browser.')}catch(e){notify(e.message)}};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify(rooms,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='nathans-home-rooms.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
$('import').onchange=async()=>{try{const file=$('import').files[0];if(!file)return;if(file.size>100000)throw Error('Room map is too large.');rooms=validateRooms(JSON.parse(await file.text()));selected=rooms[0]?.id;save();renderRooms();renderEditor();updateVisuals();notify('Room map imported.')}catch(e){notify(`Import failed: ${e.message}`)}finally{$('import').value=''}};
renderRooms();renderEditor();updateVisuals();renderer.setAnimationLoop(()=>{controls.update();positionLabels();renderer.render(scene,camera)});
