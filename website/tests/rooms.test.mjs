import test from 'node:test';
import assert from 'node:assert/strict';
import {roomState,validateRooms,defaults} from '../public/rooms.mjs';
const room={...defaults[0],entities:['light.a','light.b']};
test('off differs from unavailable; any known on wins',()=>{
 const s=entities=>({status:'connected',entities});
 assert.equal(roomState(room,'live',s([{id:'light.a',state:'off'},{id:'light.b',state:'off'}])).level,0);
 assert.equal(roomState(room,'live',s([{id:'light.a',state:'off'}])).level,null);
 assert.equal(roomState(room,'live',s([{id:'light.a',state:'on',brightness:128},{id:'light.b',state:'unavailable'}])).level,128/255);
 assert.equal(roomState(room,'live',{status:'disconnected',entities:[{id:'light.a',state:'on'}]}).level,null);
});
test('demo does not depend on real entities',()=>{assert.equal(roomState({...room,demo:.6},'demo',{status:'connected',entities:[]}).level,.6)});
test('mapping rejects invalid bounds, IDs and non-light entities',()=>{
 assert.doesNotThrow(()=>validateRooms(structuredClone(defaults)));
 for(const patch of [{min:[NaN,0,0]},{max:room.min},{entities:['lock.front_door']},{demo:2}])assert.throws(()=>validateRooms([{...room,...patch}]));
 assert.throws(()=>validateRooms([room,room]));
});
