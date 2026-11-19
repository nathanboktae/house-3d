// Ambient sensors verified against Home Assistant, November 18, 2026.
// Do not substitute switch internal temperatures for room temperatures.
// Entryway and Storage readings are excluded: the user confirmed they are not authoritative.
// Confirmed sensor-free: fifth bedroom, office, dining room, primary closet,
// hallways and stairs. Missing Zooz Sensor and Unused Bath Sensor are not installed.
export const roomTemperatures = {
 'primary-bedroom':'sensor.primary_bedroom_temperature',
 'primary-bath':'sensor.primary_bath_sensor_temperature',
 'main-bath':'sensor.main_bath_fan_temperature',
 'morgans-bedroom':'sensor.morgans_bedroom_sensor_temperature',
 'living-room':'sensor.living_room_temperature',
 kitchen:'sensor.kitchen_sensor_temperature',
 'basement-bathroom':'sensor.basement_bath_temperature',
 den:'sensor.media_room_th_sensor_temperature',
 'thomas-bedroom':'sensor.thomas_bedroom_sensor_temperature',
 laundry:'sensor.washer_door_device_temperature',
 garage:'sensor.garage_sensor_temperature',
};
export const roomClimates = {'primary-bedroom':'climate.primary_bedroom_mini_split','living-room':'climate.living_room_mini_split',garage:'climate.garage_heater'};
export const CENTRAL_CLIMATE = 'climate.central_heater';
export const climateIDs = new Set([...Object.values(roomClimates), CENTRAL_CLIMATE]);
export function formatTemperature(value, unit='°F') {
 return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? `${Number(Number(value).toFixed(1))}${unit}` : 'Unavailable';
}
export function roomTemperature(roomID, snapshot) {
 const id=roomTemperatures[roomID];
 if(!id)return null;
 const e=snapshot.entities.find(e=>e.id===id);
 return snapshot.status==='connected' && e ? formatTemperature(e.state,e.unit) : 'Unavailable';
}
export function climateCommand(entity, action) {
 if(!entity || !climateIDs.has(entity.id) || ['unknown','unavailable'].includes(entity.state))throw Error('Climate device unavailable.');
 const command={type:'call_service',domain:'climate',target:{entity_id:entity.id}};
 if(action==='power') {
  const feature=entity.state==='off'?128:256;
  if(entity.features & feature)return {...command,service:entity.state==='off'?'turn_on':'turn_off'};
  const mode=entity.state==='off' ? (entity.hvacModes.includes('heat')?'heat':entity.hvacModes.find(m=>m!=='off')) : 'off';
  if(!mode || !entity.hvacModes.includes(mode))throw Error('Power control is unavailable.');
  return {...command,service:'set_hvac_mode',service_data:{hvac_mode:mode}};
 }
 if(!['increase','decrease'].includes(action))throw Error('Invalid climate action.');
 if(!(entity.features & 1))throw Error('Single target temperature is unsupported.');
 const base=Number.isFinite(entity.temperature)?entity.temperature:entity.currentTemperature;
 if(!Number.isFinite(base)||!Number.isFinite(entity.minTemp)||!Number.isFinite(entity.maxTemp))throw Error('Temperature limits or current temperature unavailable.');
 const step=entity.step>0?entity.step:1;
 const temperature=Number(Math.max(entity.minTemp,Math.min(entity.maxTemp,base+(action==='increase'?step:-step))).toFixed(2));
 return {...command,service:'set_temperature',service_data:{temperature}};
}
