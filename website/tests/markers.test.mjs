import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Minimal DOM for checking node identity during the real app's marker updates.
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.style={};this.attributes={};this.textContent='';}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node)}}
 remove(){this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=null;}
 replaceChildren(...nodes){for(const child of this.children)child.parent=null;this.children=[];this.append(...nodes)}
 setAttribute(key,value){this.attributes[key]=String(value)}
}
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const markerCode=source.slice(source.indexOf('function deviceButton('),source.indexOf('function positionLabels('));
test('HA updates preserve mounted light buttons while updating their state',()=>{
 const room={id:'entryway',name:'Entryway',entities:['light.entryway']};
 const snapshot={status:'connected',entities:[{id:'light.entryway',name:'Entryway',state:'off'}]};
 const layer=new Element('div');
 const context=vm.createContext({tvMode:false,document:{createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})},snapshot,rooms:[room],activeView:'upper',labelLayer:layer,roomLabels:[],visibleOnFloor:()=>true,visibleDevices:r=>r.entities,roomTemperature:()=>null,roomClimates:{},climatePending:new Map(),optimistic:{intents:new Map()},controlEntity:()=>{}});
 vm.runInContext(markerCode,context);
 vm.runInContext('renderLabels()',context);
 const marker=layer.children[0],bulb=marker.children[2].children[0].children[0];
 // An unrelated sensor event must not detach the hovered/focused control.
 snapshot.entities.push({id:'sensor.unrelated',state:'72'});
 for(let i=0;i<20;i++)vm.runInContext('renderLabels()',context);
 assert.equal(layer.children[0],marker);
 assert.equal(marker.children[2].children[0].children[0],bulb);
 assert.equal(bulb.attributes['aria-pressed'],'false');
 snapshot.entities[0].state='on';
 vm.runInContext('renderLabels()',context);
 assert.equal(marker.children[2].children[0].children[0],bulb);
 assert.equal(bulb.attributes['aria-pressed'],'true');
 assert.equal(bulb.className,'room-bulb on');
 context.activeView='lower';context.visibleOnFloor=()=>false;
 vm.runInContext('renderLabels()',context);
 assert.equal(layer.children.length,0);
});
