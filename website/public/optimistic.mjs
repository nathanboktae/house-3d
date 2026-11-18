/** Local intent overlays reported state until the device catches up. */
export class OptimisticControls {
  constructor(send, changed, {settleMs=30000, schedule=(fn,ms)=>setTimeout(fn,ms), cancel=timer=>clearTimeout(timer)}={}) {
    Object.assign(this,{send,changed,settleMs,schedule,cancel});
    this.reported={status:'not_configured',entities:[]};
    this.intents=new Map();this.workers=new Map();
  }
  project() {
    return {...this.reported,entities:this.reported.entities.map(e=>{
      const intent=this.intents.get(e.id);
      return intent?{...e,...intent.value}:e;
    })};
  }
  remove(id) {
    const intent=this.intents.get(id);
    if(intent)this.cancel(intent.timer);
    this.intents.delete(id);
  }
  reconcile(snapshot) {
    this.reported=snapshot;
    if(snapshot.status!=='connected') {
      for(const id of this.intents.keys())this.remove(id);
      this.workers.clear();
    } else for(const [id,intent] of this.intents) {
      const e=snapshot.entities.find(e=>e.id===id);
      if(!e||!['on','off'].includes(e.state)) {this.remove(id);continue;}
      // A service acknowledgement alone isn't confirmation. Ignore intermediate
      // transition levels and allow the device's 0..255 brightness rounding.
      const matches=e.state===intent.value.state && (intent.brightness===undefined || e.state==='off' ||
        (Number.isFinite(e.brightness)&&Math.abs(e.brightness-intent.value.brightness)<=2));
      if(intent.accepted && matches && e.updated!==intent.baseline)this.remove(id);
    }
    return this.project();
  }
  set(id,on,brightness) {
    const e=this.reported.entities.find(e=>e.id===id);
    if(this.reported.status!=='connected'||!e||!['on','off'].includes(e.state)||e.members?.length)return;
    if(brightness!==undefined && (!e.dimmable||!Number.isInteger(brightness)||brightness<0||brightness>100))return;
    this.remove(id);
    const value={state:(brightness===undefined?on:brightness>0)?'on':'off'};
    if(brightness!==undefined)value.brightness=Math.round(brightness*255/100);
    const intent={value,on:value.state==='on',brightness,accepted:false,baseline:e.updated};
    this.intents.set(id,intent);
    this.changed();
    if(!this.workers.has(id))void this.flush(id);
  }
  async flush(id) {
    const worker={};this.workers.set(id,worker);
    try {
      while(this.workers.get(id)===worker) {
        const intent=this.intents.get(id);
        if(!intent || intent.accepted)break;
        intent.baseline=this.reported.entities.find(e=>e.id===id)?.updated;
        try {
          await this.send(id,intent.on,intent.brightness);
        } catch(error) {
          if(this.workers.get(id)!==worker)return;
          if(this.intents.get(id)===intent) {this.remove(id);this.changed(error.message);}
          continue;
        }
        if(this.workers.get(id)!==worker)return;
        if(this.intents.get(id)!==intent)continue; // Send only the newest queued edit.
        intent.accepted=true;
        intent.timer=this.schedule(()=>{
          if(this.intents.get(id)!==intent)return;
          this.remove(id);this.changed('Device has not confirmed the change. Showing its latest reported state.');
        },this.settleMs);
        this.reconcile(this.reported);
        this.changed();
        break;
      }
    } finally {if(this.workers.get(id)===worker)this.workers.delete(id);}
  }
}
