import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const views=JSON.parse(readFileSync(new URL('../public/views.json',import.meta.url),'utf8'));

test('TV rotates the three views every twelve seconds without routing and pauses while hidden',()=>{
 const shown=[];let tick,finishFade;
 const classes=new Set();
 const document={hidden:false};
 const context=vm.createContext({tvMode:true,views,document,stage:{classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}},setTimeout:(callback,delay)=>{assert.equal(delay,350);finishFade=callback},setView:route=>shown.push(route.id),setInterval:(callback,delay)=>{assert.equal(delay,12000);tick=callback},createRouter:()=>assert.fail('TV must not change browser history')});
 vm.runInContext(source.slice(source.indexOf('let router;'),source.indexOf('restoreConnection();',source.indexOf('let router;'))),context);
 assert.deepEqual(shown,['upper']);
 tick();assert.equal(classes.has('tv-fading'),true);assert.deepEqual(shown,['upper']);
 finishFade();assert.equal(classes.has('tv-fading'),false);
 tick();finishFade();tick();finishFade();assert.deepEqual(shown,['upper','lower','outside','upper']);
 document.hidden=true;tick();assert.equal(shown.length,4);
 document.hidden=false;tick();finishFade();assert.equal(shown.at(-1),'lower');
});

test('TV device controls cannot send commands and still display on/off state',()=>{
 let commands=0;
 const context=vm.createContext({tvMode:true,snapshot:{status:'connected',entities:[{id:'light.test',name:'Test',state:'on'}]},optimistic:{intents:new Map(),set:()=>commands++},notify:()=>{},button:{setAttribute(){}}});
 vm.runInContext(source.slice(source.indexOf('function controlEntity('),source.indexOf('function visibleDevices(')),context);
 vm.runInContext(source.slice(source.indexOf('function updateDeviceButton('),source.indexOf('const roomMarkerCache')),context);
 vm.runInContext("controlEntity('light.test');updateDeviceButton(button,'light.test',true)",context);
 assert.equal(commands,0);assert.equal(context.button.disabled,true);assert.equal(context.button.className,'room-bulb on');
});
