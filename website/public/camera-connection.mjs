/** MJPEG connection supervision. Image dimensions detect first frames even when
 * browsers defer the load event until the multipart response finishes.
 * Native img streams do not expose per-frame timestamps or silent stalls. */
export class CameraConnection {
 constructor(image, report, {setTimer=setTimeout, clearTimer=clearTimeout, now=Date.now}={}) {
  Object.assign(this,{image,report,setTimer,clearTimer,now});
  this.source=null;this.failures=0;this.generation=0;this.timer=null;
 }
 clear(){this.clearTimer(this.timer);this.timer=null;}
 update(source){
  if(source===this.source)return;
  this.stop();this.source=source;this.failures=0;
  if(source)this.connect();
 }
 stop(){
  this.clear();this.generation++;this.source=null;
  this.image.onload=null;this.image.onerror=null;
  this.image.removeAttribute('src');this.image.hidden=true;
 }
 retry(){if(this.source){this.failures=0;this.connect()}}
 connect(){
  this.clear();const generation=++this.generation;
  this.image.onload=null;this.image.onerror=null;this.image.removeAttribute('src');
  this.image.hidden=true;this.report('connecting');
  const started=this.now();let liveSince=null,failed=false;
  const valid=()=>generation===this.generation&&!!this.source&&!failed;
  const fail=reason=>{
   if(!valid())return;
   failed=true;this.clear();this.image.onload=null;this.image.onerror=null;
   this.image.removeAttribute('src');this.image.hidden=true;
   const delay=Math.min(120000,5000*2**Math.min(this.failures++,5));
   this.report('retrying',delay,reason);
   this.timer=this.setTimer(()=>{if(generation===this.generation&&this.source)this.connect()},delay);
  };
  const markLive=()=>{
   if(!valid()||!this.image.naturalWidth)return;
   if(liveSince===null){liveSince=this.now();this.image.hidden=false;this.report('live')}
  };
  this.image.onload=markLive;this.image.onerror=()=>fail('Camera connection failed.');
  const check=()=>{
   if(!valid())return;
   markLive();
   if(liveSince===null&&this.now()-started>=30000){fail('Camera connection timed out.');return}
   // Briefly successful/flapping feeds must not keep resetting their backoff.
   if(liveSince!==null&&this.now()-liveSince>=60000)this.failures=0;
   this.timer=this.setTimer(check,1000);
  };
  const url=new URL(this.source);url.searchParams.set('_reconnect',`${this.now()}-${generation}`);
  this.image.src=url.href;
  this.timer=this.setTimer(check,1000);
 }
}
