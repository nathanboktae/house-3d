import test from 'node:test';
import assert from 'node:assert/strict';
import {climateCommand,roomTemperature,roomTemperatures} from '../public/climate.mjs';
import {HomeAssistant} from '../public/ha.mjs';
const thermostat={id:'climate.central_heater',state:'heat',features:393,hvacModes:['off','auto','heat','cool'],temperature:70,currentTemperature:69,minTemp:50,maxTemp:86,step:.5};
test('power uses native turn on/off to preserve device mode',()=>{
 assert.equal(climateCommand(thermostat,'power').service,'turn_off');
 assert.equal(climateCommand({...thermostat,state:'off'},'power').service,'turn_on');
});
test('adjustments use the device step and clamp to bounds without changing mode',()=>{
 assert.deepEqual(climateCommand(thermostat,'increase'),{type:'call_service',domain:'climate',target:{entity_id:thermostat.id},service:'set_temperature',service_data:{temperature:70.5}});
 assert.equal(climateCommand({...thermostat,temperature:86},'increase').service_data.temperature,86);
 assert.equal(climateCommand({...thermostat,temperature:50},'decrease').service_data.temperature,50);
 assert.equal(climateCommand({...thermostat,temperature:null},'increase').service_data.temperature,69.5);
});
test('rejects unavailable, unrelated and unsupported devices',()=>{
 for(const patch of [{state:'unavailable'},{id:'climate.incognito_climate'},{temperature:null,currentTemperature:null},{features:0},{minTemp:undefined}])assert.throws(()=>climateCommand({...thermostat,...patch},'increase'));
});
test('room readings preserve units and never show disconnected or invalid readings',()=>{
 const id=roomTemperatures.kitchen;
 const snapshot={status:'connected',entities:[{id,state:'21.345',unit:'°C'}]};
 assert.equal(roomTemperature('kitchen',snapshot),'21.3°C');
 assert.equal(roomTemperature('5th-bedroom',snapshot),null);
 assert.equal(roomTemperature('kitchen',{...snapshot,status:'disconnected'}),'Unavailable');
 assert.equal(roomTemperature('kitchen',{...snapshot,entities:[{id,state:'unknown'}]}),'Unavailable');
 assert(!Object.values(roomTemperatures).some(id=>id.includes('internal')));
});
test('HA retains temperature/climate updates and validates service calls',async()=>{
 const client=new HomeAssistant(()=>{});const calls=[];
 client.apply({entity_id:'sensor.kitchen_sensor_temperature',state:'70',attributes:{device_class:'temperature',unit_of_measurement:'°F'}});
 client.apply({entity_id:'sensor.kitchen_battery',state:'90',attributes:{device_class:'battery'}});
 client.apply({entity_id:thermostat.id,state:'heat',attributes:{temperature:70,current_temperature:69,min_temp:50,max_temp:86,target_temp_step:.5,supported_features:393,hvac_modes:thermostat.hvacModes}});
 assert.equal(client.entities.size,2);
 await assert.rejects(client.setClimate(thermostat.id,'increase'),/Connect/);
 client.status='connected';client.sendCommand=async command=>{calls.push(command)};
 await client.setClimate(thermostat.id,'decrease');assert.equal(calls[0].service_data.temperature,69.5);
 client.apply(null,thermostat.id);await assert.rejects(client.setClimate(thermostat.id,'power'),/unavailable/);
});
