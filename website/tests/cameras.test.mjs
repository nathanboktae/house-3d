import test from 'node:test';
import assert from 'node:assert/strict';
import {outdoorCameras,findCamera,cameraStreamURL} from '../public/cameras.mjs';
import {HomeAssistant} from '../public/ha.mjs';
test('discovers camera entities and matches friendly names or entity IDs without guessing ambiguous feeds',()=>{
 const ha=new HomeAssistant(()=>{});
 ha.apply({entity_id:'camera.driveway',state:'idle',attributes:{friendly_name:'Garage',access_token:'camera-only'}});
 const entities=[...ha.entities.values()];
 assert.equal(findCamera(entities,outdoorCameras[0]).id,'camera.driveway');
 assert.equal(findCamera([{id:'camera.garage_cam_hd_stream',name:'Garage Cam HD Stream'},{id:'camera.garage_cam_sd_stream',name:'Garage Cam SD Stream'}],outdoorCameras[0]).id,'camera.garage_cam_hd_stream');
 assert.equal(entities[0].cameraToken,'camera-only');
 assert.equal(findCamera([{id:'camera.back_yard_main',name:'Main'}],outdoorCameras[2]).id,'camera.back_yard_main');
 assert.equal(findCamera([{id:'camera.garage_main',name:'Main'},{id:'camera.garage_sub',name:'Sub'}],outdoorCameras[0]),null);
 assert.equal(findCamera([{id:'light.garage',name:'Garage'}],outdoorCameras[0]),null);
});
test('uses the HA origin and a camera token for standalone and ingress streams',()=>{
 const entity={id:'camera.garage',state:'idle',cameraToken:'camera-only'};
 for(const config of [{url:'https://ha.example',token:'account-secret'},{url:'wss://ha.example/api/hassio_ingress/abc/api/websocket',ingress:true}]){
  assert.equal(cameraStreamURL(entity,config),'https://ha.example/api/camera_proxy_stream/camera.garage?token=camera-only');
 }
 assert.equal(cameraStreamURL({...entity,state:'unavailable'},{url:'https://ha.example'}),null);
 assert.equal(cameraStreamURL({...entity,cameraToken:undefined},{url:'https://ha.example',token:'account-secret'}),null);
 assert.equal(cameraStreamURL(entity,null),null);
});
