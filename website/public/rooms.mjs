export const MAX_ROOMS=16;
export const defaults=[
{id:'kitchen',name:'Kitchen · draft',min:[7,-.15,-7.5],max:[12.2,5.8,-3],entities:[],demo:1},
{id:'living',name:'Living room · draft',min:[3.5,-.15,-7.5],max:[7,5.8,-2.4],entities:[],demo:.75},
{id:'bedrooms',name:'Bedrooms · draft',min:[-3.4,-.15,-2.4],max:[7.5,5.8,2.7],entities:[],demo:0}
];
export function validateRooms(rooms){
 if(!Array.isArray(rooms)||rooms.length>MAX_ROOMS)throw Error('Use at most 16 rooms.');
 const ids=new Set();
 for(const r of rooms){
  if(typeof r.id!=='string'||ids.has(r.id)||typeof r.name!=='string'||!r.name.trim()||r.name.length>60)throw Error('Each room needs a unique ID and a name.');ids.add(r.id);
  if(![r.min,r.max].every(v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<1000))||r.min.some((n,i)=>n>=r.max[i]))throw Error('Every minimum must be smaller than its maximum.');
  if(!Array.isArray(r.entities)||!r.entities.every(e=>typeof e==='string'&&/^(light|switch)\.[a-z0-9_]+$/.test(e)))throw Error('Map only light or switch entity IDs.');
  if(!Number.isFinite(r.demo)||r.demo<0||r.demo>1)throw Error('Invalid demo brightness.');
 }return rooms;
}
export function roomState(room,mode,snapshot){
 if(mode==='demo')return {level:room.demo,label:room.demo>0?'Demo · on':'Demo · off'};
 if(snapshot.status!=='connected')return {level:null,label:'Connection unavailable'};
 if(!room.entities.length)return {level:null,label:'No lights mapped'};
 const entities=new Map(snapshot.entities.map(e=>[e.id,e]));let level=0,unknown=false;
 for(const id of room.entities){const e=entities.get(id);if(!e||!['on','off'].includes(e.state)){unknown=true;continue}if(e.state==='on')level=Math.max(level,typeof e.brightness==='number'?Math.max(.01,Math.min(1,e.brightness/255)):1)}
 return level>0?{level,label:unknown?'On · some states unknown':'On'}:unknown?{level:null,label:'State unavailable'}:{level:0,label:'Off'};
}
