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

import {footprintOf,pointInFootprint,visibleOnFloor,resizeRoom,loadRoomMap,ROOM_STORAGE_KEY,LEGACY_STORAGE_KEY} from '../public/rooms.mjs';
test('confirmed map includes all references, one shared stairway, and both Den lights',()=>{
 assert.equal(defaults.length,20);
 assert.deepEqual(defaults.find(r=>r.id==='upper-hallway').entities,['light.upper_hallway']);
 assert.equal(defaults.flatMap(r=>r.references).length,20);
 assert.deepEqual(defaults.find(r=>r.id==='stairway').references,['M12','B6']);
 assert.deepEqual(defaults.find(r=>r.id==='den').entities,['light.den','light.media']);
 const hall=defaults.find(r=>r.id==='basement-hallway');
 assert.equal(hall.name,'Basement Hallway');assert.deepEqual(hall.entities,['light.basement_hallway']);
 assert.equal(defaults.flatMap(r=>r.entities).length,21);
 assert.ok(!defaults.flatMap(r=>r.entities).includes('light.front_door'));
 for(const r of defaults)assert.ok(pointInFootprint([r.labelPosition[0],r.labelPosition[2]],footprintOf(r)),r.name);
});
test('floor selection includes the shared stairway and hides downstairs labels in all-floors view',()=>{
 const stair=defaults.find(r=>r.id==='stairway'),den=defaults.find(r=>r.id==='den');
 for(const floor of ['upper','lower','all'])assert.ok(visibleOnFloor(stair,floor,true));
 assert.ok(visibleOnFloor(den,'lower'));assert.ok(visibleOnFloor(den,'all'));
 assert.equal(visibleOnFloor(den,'upper'),false);assert.equal(visibleOnFloor(den,'all',true),false);
 assert.equal(defaults.filter(r=>visibleOnFloor(r,'upper')).length,12);
 assert.equal(defaults.filter(r=>visibleOnFloor(r,'lower')).length,9);
});
test('concave storage footprint excludes the stairwell and adjacent cutout',()=>{
 const storage=defaults.find(r=>r.id==='storage-room'),stairs=defaults.find(r=>r.id==='stairway');
 assert.equal(pointInFootprint([stairs.labelPosition[0],stairs.labelPosition[2]],storage.footprint),false);
 const point=[4.75,-1.5];
 assert.ok(point[0]>storage.min[0]&&point[0]<storage.max[0]&&point[1]>storage.min[2]&&point[1]<storage.max[2]);
 assert.equal(pointInFootprint(point,storage.footprint),false);
});
test('resizing preserves polygon and label proportions without mutating the source',()=>{
 const old=structuredClone(defaults[0]),min=old.min.map(n=>n+1),max=old.max.map(n=>n+2),next=resizeRoom(old,min,max);
 assert.deepEqual(old,defaults[0]);assert.deepEqual(next.min,min);assert.deepEqual(next.max,max);
 assert.ok(pointInFootprint([next.labelPosition[0],next.labelPosition[2]],next.footprint));
 assert.throws(()=>resizeRoom(old,old.max,old.min));
});
test('legacy draft migration replaces only untouched shapes and preserves custom work',()=>{
 const draft=[
  {id:'kitchen',name:'Kitchen · draft',min:[7,-.15,-7.5],max:[12.2,5.8,-3],entities:[],demo:0},
  {id:'living',name:'Living room · draft',min:[3.5,-.15,-7.5],max:[7,5.8,-2.4],entities:[],demo:.75},
  {id:'bedrooms',name:'Bedrooms · draft',min:[-3.4,-.15,-2.4],max:[7.5,5.8,2.7],entities:[],demo:1},
 ];
 const data=new Map([[LEGACY_STORAGE_KEY,JSON.stringify(draft)]]),storage={getItem:k=>data.get(k)??null};
 assert.deepEqual(loadRoomMap(storage).rooms,defaults);
 draft[0].entities=['light.custom'];data.set(LEGACY_STORAGE_KEY,JSON.stringify(draft));
 assert.equal(loadRoomMap(storage).preserved,true);assert.deepEqual(loadRoomMap(storage).rooms,draft);
 data.set(ROOM_STORAGE_KEY,'[]');assert.deepEqual(loadRoomMap(storage).rooms,[]);
});
test('unmapped rooms stay neutral in live mode, including disconnected state',()=>{
 const empty={...defaults[0],entities:[]};
 assert.equal(roomState(empty,'live',{status:'connected',entities:[]}).level,null);
 assert.equal(roomState(empty,'live',{status:'disconnected',entities:[]}).label,'No smart lights mapped');
});

test('office and kitchen resolve the actual HA entities, including both kitchen lights off',()=>{
 const office=defaults.find(r=>r.id==='office'),kitchen=defaults.find(r=>r.id==='kitchen');
 const entities=[
  {id:'light.office',state:'on',brightness:128},
  {id:'light.kitchen_east_lights',state:'off'},
  {id:'light.kitchen_west',state:'off'},
 ];
 const snapshot={status:'connected',entities};
 assert.deepEqual(office.entities,['light.office']);
 assert.deepEqual(kitchen.entities,['light.kitchen_east_lights','light.kitchen_west']);
 assert.equal(roomState(office,'live',snapshot).level,128/255);
 assert.deepEqual(roomState(kitchen,'live',snapshot),{level:0,label:'Off'});
 entities[2]={id:'light.kitchen_west',state:'on',brightness:255};
 assert.equal(roomState(kitchen,'live',snapshot).level,1);
 entities[2]={id:'light.kitchen_west',state:'unavailable'};
 assert.equal(roomState(kitchen,'live',snapshot).level,null);
});


test('basement bathroom fan is separate from room lighting and storage is mapped',()=>{
 const bath=defaults.find(r=>r.id==='basement-bathroom');
 assert.deepEqual(bath.entities,['light.basement_bath']);
 assert.deepEqual(bath.fans,['fan.basement_bath']);
 assert.deepEqual(defaults.find(r=>r.id==='storage-room').entities,['light.storage_room']);
 assert.equal(roomState(bath,'live',{status:'connected',entities:[{id:'light.basement_bath',state:'off'},{id:'fan.basement_bath',state:'on'}]}).level,0);
 assert.throws(()=>validateRooms([{...bath,fans:['lock.front_door']} ]));
});

test('crawlspace has its own light and marker to the right of storage',()=>{
 const crawl=defaults.find(r=>r.id==='crawlspace'),storage=defaults.find(r=>r.id==='storage-room');
 assert.deepEqual(crawl.entities,['light.crawlspace_light']);
 assert.equal(crawl.floor,'lower');
 assert.ok(crawl.labelPosition[0]>storage.labelPosition[0]);
 assert.ok(!pointInFootprint([crawl.labelPosition[0],crawl.labelPosition[2]],footprintOf(storage)));
});
