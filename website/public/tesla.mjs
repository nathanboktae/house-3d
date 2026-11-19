export const TESLA_BATTERY = 'sensor.rollo_battery_level';
export const TESLA_CHARGING = 'sensor.rollo_charging';
export const teslaSensors = new Set([TESLA_BATTERY, TESLA_CHARGING]);

export function teslaStatus(snapshot) {
 const connected=snapshot.status==='connected';
 const raw=connected?snapshot.entities.find(entity=>entity.id===TESLA_BATTERY)?.state:null;
 const value=typeof raw==='string'&&raw.trim()!==''?Number(raw):NaN;
 const battery=Number.isFinite(value)&&value>=0&&value<=100?Math.round(value):null;
 const state=connected?snapshot.entities.find(entity=>entity.id===TESLA_CHARGING)?.state:null;
 return {battery,charging:state==='charging',label:({charging:'Charging',disconnected:'Unplugged',stopped:'Charging stopped',complete:'Charge complete',starting:'Starting charge'})[state]||'Charging status unavailable'};
}
