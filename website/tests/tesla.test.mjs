import test from 'node:test';
import assert from 'node:assert/strict';
import {teslaStatus,TESLA_BATTERY,TESLA_CHARGING} from '../public/tesla.mjs';
import {HomeAssistant} from '../public/ha.mjs';
const snapshot=(battery,charging='charging',status='connected')=>({status,entities:[{id:TESLA_BATTERY,state:battery},{id:TESLA_CHARGING,state:charging}]});
test('Tesla battery preserves zero and only reports active charging as charging',()=>{
 assert.deepEqual(teslaStatus(snapshot('58')),{battery:58,charging:true,label:'Charging'});
 assert.equal(teslaStatus(snapshot('0')).battery,0);
 for(const state of ['disconnected','stopped','complete','starting','unavailable'])assert.equal(teslaStatus(snapshot('58',state)).charging,false);
 for(const value of ['',null,'unknown','unavailable','-1','101'])assert.equal(teslaStatus(snapshot(value)).battery,null);
 assert.deepEqual(teslaStatus(snapshot('58','charging','disconnected')),{battery:null,charging:false,label:'Charging status unavailable'});
});
test('HA retains the two Tesla sensors, filters unrelated sensors and applies updates',()=>{
 const client=new HomeAssistant(()=>{});
 for(const id of [TESLA_BATTERY,TESLA_CHARGING,'sensor.other_battery'])client.apply({entity_id:id,state:'58',attributes:{device_class:'battery'}});
 assert.equal(client.entities.size,2);
 client.apply({entity_id:TESLA_CHARGING,state:'charging',attributes:{device_class:'enum'}});
 assert.equal(client.entities.get(TESLA_CHARGING).state,'charging');
 client.apply(null,TESLA_BATTERY);assert.equal(client.entities.has(TESLA_BATTERY),false);
});
