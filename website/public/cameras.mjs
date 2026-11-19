/** Outdoor camera layout; names resolve against the authenticated HA inventory. */
export const outdoorCameras = [
  {key:'garage',entityId:'camera.garage_cam_hd_stream',name:'Garage',aliases:['garage'],lights:[['light.garage','Garage Light']]},
  {key:'front-door',entityId:'camera.front_door_hd_stream',name:'Front Door',aliases:['front door'],lights:[['light.front_door','Front Door Light']]},
  {key:'backyard',entityId:'camera.backyard_cam',name:'Backyard',aliases:['backyard','back yard'],lights:[['light.backyard_cam_floodlight','Backyard Light'],['light.deck_light','Deck Light']]},
  {key:'north-face',entityId:'camera.outside_north_hd_stream',name:'North Face',aliases:['north face'],lights:[]},
];
const normalize = value => value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function findCamera(entities, config) {
  const configured=entities.find(entity=>entity.id===config.entityId);
  if(configured)return configured;
  const cameras=entities.filter(entity=>entity.id.startsWith('camera.'));
  const exact=cameras.filter(entity=>config.aliases.some(alias=>[normalize(entity.id.slice(7)),normalize(entity.name)].includes(alias)));
  if(exact.length===1)return exact[0];
  const matches=cameras.filter(entity=>config.aliases.some(alias=>[normalize(entity.id.slice(7)),normalize(entity.name)].some(name=>` ${name} `.includes(` ${alias} `))));
  return matches.length===1?matches[0]:null;
}
export function cameraStreamURL(entity, config) {
  if(!entity||!config?.url||!/^camera\.[a-z0-9_]+$/.test(entity.id)||['unavailable','unknown','off'].includes(entity.state)||!entity.cameraToken)return null;
  // Camera-scoped tokens only: never expose the HA account token in an image URL.
  const origin=new URL(config.url);origin.protocol=origin.protocol==='wss:'?'https:':origin.protocol==='ws:'?'http:':origin.protocol;
  if(!['https:','http:'].includes(origin.protocol))return null;
  const url=new URL(`/api/camera_proxy_stream/${entity.id}`,origin.origin);
  url.searchParams.set('token',entity.cameraToken);
  return url.href;
}
