import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { DEFAULT_SETTINGS, type DeskState } from "../src/types";

const bundle = (await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {Assistant} from './src/Assistant'; window.root = createRoot(document.getElementById('root')); window.renderFixture = () => window.root.render(React.createElement(Assistant, {desk: window.fixture, refresh: async()=>{}, openSettings:()=>{}})); window.renderFixture();`,
    resolveDir: process.cwd(), loader: "tsx",
  },
  bundle: true, write: false, format: "iife", platform: "browser", define: { "process.env.NODE_ENV": '"production"' },
})).outputFiles[0].text;
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

function state(kind: string): DeskState {
  const context = kind === "no chat" ? null : {
    chatId: "fixture", name: "Test customer", isGroup: kind === "group", messages: [],
    lastIncomingAt: null, lastIncomingId: null, composerEmpty: kind !== "occupied", atBottom: false, observedAt: Date.now(),
  };
  return {settings: {...DEFAULT_SETTINGS, autoSend: true}, hasKey: true, models: [], knowledge: [], followUps: [], draft: null, activity: "", replyTiming: null, inbox: null, context,
    clients: context ? {fixture: {chatId: "fixture", name: "Test customer", human: kind === "human takeover", notes: "", stage: "Client", lastIncomingAt: null, lastIncomingId: null, lastSeen: Date.now()}} : {}};
}

for (const kind of ["no chat", "group", "occupied", "human takeover"]) {
  test(`manual assistance stays enabled for ${kind} and always requests panel-only help`, async () => {
    const dom = new JSDOM('<div id="root"></div>', {url: 'https://extension.test/panel.html?tabId=1', runScripts: 'outside-only', pretendToBeVisual: true});
    const requests: any[] = [];
    let finish: (value: unknown) => void = () => {};
    (dom.window as any).fixture = state(kind);
    (dom.window as any).chrome = {runtime: {id: 'fixture', sendMessage: (message: unknown) => { requests.push(message); return new Promise((resolve) => { finish = resolve; }); }}};
    dom.window.eval(bundle);
    await tick();
    const button = dom.window.document.querySelector<HTMLButtonElement>('.draft-button')!;
    assert.ok(button);
    assert.equal(button.disabled, false);
    button.click();
    await tick();
    assert.equal(button.disabled, true);
    assert.equal(requests[0].type, 'GENERATE');
    assert.equal(requests[0].assistOnly, true);
    finish({ok: false, error: 'Connection timed out. Try again.'});
    await tick();
    assert.equal(button.disabled, false);
    assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!, /timed out/);
    (dom.window as any).root.unmount();
    dom.window.close();
  });
}

test("dictation keeps editable panel text, syncs it to WhatsApp, and never sends", async () => {
  const dom = new JSDOM('<div id="root"></div>', {url: 'https://extension.test/panel.html?tabId=1', runScripts: 'outside-only', pretendToBeVisual: true});
  const requests: any[] = [];
  (dom.window as any).fixture = state("human takeover");
  (dom.window as any).chrome = {runtime: {id: 'fixture', sendMessage: async (message: any) => {
    requests.push(message);
    if (message.type === 'RECORD_AUDIO_STOP') return {ok:true,value:{audio:'AQIDBA==',mimeType:'audio/webm'}};
    if (message.type === 'TRANSCRIBE_AUDIO') return {ok:true,value:{text:'Thank you, I will call you tomorrow.'}};
    if (message.type === 'SYNC_MESSAGE') return {ok:true,value:{synced:true,text:message.text}};
    return {ok:true,value:{}};
  }}};
  try {
    dom.window.eval(bundle);
    await tick();
    const primary = dom.window.document.querySelector<HTMLButtonElement>('.draft-button')!;
    assert.match(primary.textContent!, /Suggest a reply/);
    const mic = () => dom.window.document.querySelector<HTMLButtonElement>('.speech-input__toggle')!;
    mic().click();
    await tick();
    mic().click();
    await tick();
    const input = dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!;
    assert.equal(input.value, 'Thank you, I will call you tomorrow.');
    assert.match(primary.textContent!, /Ask assistant/);
    assert.equal(primary.disabled, false);
    await tick();
    const sync = requests.find((request) => request.type === 'SYNC_MESSAGE');
    assert.equal(sync.chatId, 'fixture');
    assert.equal(sync.text, 'Thank you, I will call you tomorrow.');
    assert.equal(sync.expectedText, '');
    assert.match(dom.window.document.body.textContent!, /Added to WhatsApp/);
    assert.equal(requests.some((request) => request.type === 'GENERATE'), false);
    assert.equal(requests.some((request) => request.type === 'PLACE_MESSAGE'), false);
    assert.match(dom.window.document.body.textContent!, /review and send there/i);
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Thank you, I will call tomorrow.');
    input.dispatchEvent(new dom.window.Event('input', {bubbles:true}));
    await new Promise((resolve) => setTimeout(resolve, 360));
    const syncs = requests.filter((request) => request.type === 'SYNC_MESSAGE');
    assert.equal(syncs.at(-1).expectedText, 'Thank you, I will call you tomorrow.');
    assert.equal(syncs.at(-1).text, 'Thank you, I will call tomorrow.');
  } finally {
    (dom.window as any).root.unmount();
    dom.window.close();
  }
});

test("Polish menu requests the selected style and syncs the polished result", async () => {
  const dom = new JSDOM('<div id="root"></div>', {url:'https://extension.test/panel.html?tabId=1',runScripts:'outside-only',pretendToBeVisual:true});
  const requests: any[] = [];
  (dom.window as any).fixture = state('human takeover');
  (dom.window as any).chrome = {runtime:{id:'fixture',sendMessage:async(message:any)=>{
    requests.push(message);
    if(message.type==='RECORD_AUDIO_STOP') return {ok:true,value:{audio:'AQIDBA==',mimeType:'audio/webm'}};
    if(message.type==='TRANSCRIBE_AUDIO') return {ok:true,value:{text:'hey can u send the papers'}};
    if(message.type==='POLISH_TEXT') return {ok:true,value:{text:'Could you please send the documents?'}};
    if(message.type==='SYNC_MESSAGE') return {ok:true,value:{synced:true,text:message.text}};
    return {ok:true,value:{}};
  }}};
  try {
    dom.window.eval(bundle);
    await tick();
    const mic = () => dom.window.document.querySelector<HTMLButtonElement>('.speech-input__toggle')!;
    mic().click(); await tick(); mic().click(); await tick(); await tick();
    dom.window.document.querySelector<HTMLButtonElement>('.polish-trigger')!.click();
    await tick();
    assert.ok(dom.window.document.querySelector('[role="menuitem"]'));
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await tick();
    assert.equal(dom.window.document.querySelector('[role="menuitem"]'),null);
    assert.equal(dom.window.document.activeElement,dom.window.document.querySelector('.polish-trigger'));
    dom.window.document.querySelector<HTMLButtonElement>('.polish-trigger')!.click(); await tick();
    dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!.dispatchEvent(new dom.window.Event('pointerdown',{bubbles:true})); await tick();
    assert.equal(dom.window.document.querySelector('[role="menuitem"]'),null,'outside interaction dismisses the menu');
    dom.window.document.querySelector<HTMLButtonElement>('.polish-trigger')!.click(); await tick();
    dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]').click();
    await tick(); await tick();
    assert.equal(requests.find((r)=>r.type==='POLISH_TEXT').style,'professional');
    assert.equal(dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!.value,'Could you please send the documents?');
    const syncs=requests.filter((r)=>r.type==='SYNC_MESSAGE');
    assert.equal(syncs.at(-1).text,'Could you please send the documents?');
    assert.equal(syncs.at(-1).expectedText,'hey can u send the papers');
  } finally { (dom.window as any).root.unmount(); dom.window.close(); }
});

test("a WhatsApp edit conflict preserves the draft and retries against an explicitly cleared composer", async () => {
  const dom = new JSDOM('<div id="root"></div>', {url:'https://extension.test/panel.html?tabId=1',runScripts:'outside-only',pretendToBeVisual:true});
  const requests: any[] = [];
  (dom.window as any).fixture = state('human takeover');
  (dom.window as any).fixture.context.composerEmpty = false;
  (dom.window as any).chrome = {runtime:{id:'fixture',sendMessage:async(message:any)=>{
    requests.push(message);
    if(message.type==='RECORD_AUDIO_STOP') return {ok:true,value:{audio:'AQIDBA==',mimeType:'audio/webm'}};
    if(message.type==='TRANSCRIBE_AUDIO') return {ok:true,value:{text:'The transcript stays here.'}};
    if(message.type==='SYNC_MESSAGE' && message.expectedText==='The transcript stays here.') return {ok:false,error:'The WhatsApp message changed. Review it before syncing again.'};
    if(message.type==='SYNC_MESSAGE') return {ok:true,value:{synced:true,text:message.text}};
    return {ok:true,value:{}};
  }}};
  try {
    dom.window.eval(bundle); await tick();
    const mic=()=>dom.window.document.querySelector<HTMLButtonElement>('.speech-input__toggle')!;
    mic().click(); await tick(); mic().click(); await tick(); await tick();
    assert.equal(dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!.value,'The transcript stays here.');
    const input=dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Edited transcript stays here.');
    input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    await new Promise((resolve)=>setTimeout(resolve,360));
    assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!,/WhatsApp message changed/);
    assert.ok([...dom.window.document.querySelectorAll('button')].some((b)=>b.textContent==='Try again'));
    assert.match(dom.window.document.body.textContent!,/Keep your WhatsApp edits, or clear its message box and try again/);
    dom.window.document.querySelector<HTMLButtonElement>('.assistant-sync-actions button')!.click();
    await tick(); await tick();
    assert.equal(requests.filter((r)=>r.type==='SYNC_MESSAGE').at(-1).expectedText,'The transcript stays here.','non-empty composer retries preserve the prior compare value');
    (dom.window as any).fixture.context.composerEmpty=true;
    (dom.window as any).renderFixture(); await tick();
    dom.window.document.querySelector<HTMLButtonElement>('.assistant-sync-actions button')!.click();
    await tick(); await tick();
    assert.equal(requests.filter((r)=>r.type==='SYNC_MESSAGE').at(-1).expectedText,'');
    assert.equal(dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!.value,'Edited transcript stays here.');
  } finally { (dom.window as any).root.unmount(); dom.window.close(); }
});

test("a newer panel edit wins over a pending polish result", async () => {
  const dom = new JSDOM('<div id="root"></div>', {url:'https://extension.test/panel.html?tabId=1',runScripts:'outside-only',pretendToBeVisual:true});
  let finishPolish:(value:any)=>void=()=>{};
  (dom.window as any).fixture=state('human takeover');
  (dom.window as any).chrome={runtime:{id:'fixture',sendMessage:(message:any)=>{
    if(message.type==='RECORD_AUDIO_STOP') return Promise.resolve({ok:true,value:{audio:'AQIDBA==',mimeType:'audio/webm'}});
    if(message.type==='TRANSCRIBE_AUDIO') return Promise.resolve({ok:true,value:{text:'original text'}});
    if(message.type==='POLISH_TEXT') return new Promise((resolve)=>{finishPolish=resolve;});
    if(message.type==='SYNC_MESSAGE') return Promise.resolve({ok:true,value:{synced:true,text:message.text}});
    return Promise.resolve({ok:true,value:{}});
  }}};
  try {
    dom.window.eval(bundle); await tick();
    const mic=()=>dom.window.document.querySelector<HTMLButtonElement>('.speech-input__toggle')!;
    mic().click(); await tick(); mic().click(); await tick(); await tick();
    dom.window.document.querySelector<HTMLButtonElement>('.polish-trigger')!.click();
    await tick();
    dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]').click(); await tick();
    const input=dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'my newer edit');
    input.dispatchEvent(new dom.window.Event('input',{bubbles:true})); await tick();
    finishPolish({ok:true,value:{text:'stale polished text'}}); await tick(); await tick();
    assert.equal(input.value,'my newer edit');
  } finally { (dom.window as any).root.unmount(); dom.window.close(); }
});

test("polish finishing after a customer switch cannot restore the old instruction", async () => {
  const dom=new JSDOM('<div id="root"></div>',{url:'https://extension.test/panel.html?tabId=1',runScripts:'outside-only',pretendToBeVisual:true});
  let finishPolish:(value:any)=>void=()=>{};
  (dom.window as any).fixture=state('human takeover');
  (dom.window as any).chrome={runtime:{id:'fixture',sendMessage:(message:any)=>{
    if(message.type==='POLISH_TEXT') return new Promise((resolve)=>{finishPolish=resolve;});
    return Promise.resolve({ok:true,value:{}});
  }}};
  try {
    dom.window.eval(bundle); await tick();
    const input=dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(input,'private wording for A');
    input.dispatchEvent(new dom.window.Event('input',{bubbles:true})); await tick();
    dom.window.document.querySelector<HTMLButtonElement>('.polish-trigger')!.click(); await tick();
    dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]').click(); await tick();
    const customerB=state('human takeover'); customerB.context={...customerB.context!,chatId:'customer-b',name:'Customer B'};
    (dom.window as any).fixture=customerB; (dom.window as any).renderFixture(); await tick();
    finishPolish({ok:true,value:{text:'stale polished A text'}}); await tick(); await tick();
    assert.equal(dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!.value,'');
    assert.doesNotMatch(dom.window.document.body.textContent!,/stale polished A text/);
  } finally {(dom.window as any).root.unmount();dom.window.close();}
});

test("transcription finishing after a customer switch cannot populate the new customer's instruction", async () => {
  const dom=new JSDOM('<div id="root"></div>',{url:'https://extension.test/panel.html?tabId=1',runScripts:'outside-only',pretendToBeVisual:true});
  let finishTranscript:(value:any)=>void=()=>{};
  const requests:any[]=[];
  (dom.window as any).fixture=state('human takeover');
  (dom.window as any).chrome={runtime:{id:'fixture',sendMessage:(message:any)=>{
    requests.push(message);
    if(message.type==='RECORD_AUDIO_STOP') return Promise.resolve({ok:true,value:{audio:'AQIDBA==',mimeType:'audio/webm'}});
    if(message.type==='TRANSCRIBE_AUDIO') return new Promise((resolve)=>{finishTranscript=resolve;});
    return Promise.resolve({ok:true,value:{}});
  }}};
  try {
    dom.window.eval(bundle); await tick();
    const mic=()=>dom.window.document.querySelector<HTMLButtonElement>('.speech-input__toggle')!;
    mic().click(); await tick(); mic().click(); await tick(); await tick();
    assert.ok(requests.some((r)=>r.type==='TRANSCRIBE_AUDIO'));
    const customerB=state('human takeover'); customerB.context={...customerB.context!,chatId:'customer-b',name:'Customer B'};
    (dom.window as any).fixture=customerB; (dom.window as any).renderFixture(); await tick();
    finishTranscript({ok:true,value:{text:'stale transcript for A'}}); await tick(); await tick();
    assert.equal(dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!.value,'');
    assert.equal(requests.some((r)=>r.type==='SYNC_MESSAGE'),false);
  } finally {(dom.window as any).root.unmount();dom.window.close();}
});

test("a confirmed WhatsApp send starts the next recording as a fresh draft", async () => {
  const dom=new JSDOM('<div id="root"></div>',{url:'https://extension.test/panel.html?tabId=1',runScripts:'outside-only',pretendToBeVisual:true});
  const requests:any[]=[];
  (dom.window as any).fixture=state('human takeover');
  (dom.window as any).chrome={runtime:{id:'fixture',sendMessage:async(message:any)=>{
    requests.push(message);
    if(message.type==='RECORD_AUDIO_STOP') return {ok:true,value:{audio:'AQIDBA==',mimeType:'audio/webm'}};
    if(message.type==='TRANSCRIBE_AUDIO') return {ok:true,value:{text:'A new separate thought.'}};
    if(message.type==='SYNC_MESSAGE') return {ok:true,value:{synced:true,text:message.text}};
    return {ok:true,value:{}};
  }}};
  try {
    dom.window.eval(bundle); await tick();
    const mic=()=>dom.window.document.querySelector<HTMLButtonElement>('.speech-input__toggle')!;
    mic().click(); await tick(); mic().click(); await tick(); await tick();
    const input=dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!;
    assert.equal(input.value,'A new separate thought.');
    const fixture=(dom.window as any).fixture;
    fixture.context.messages=[{id:'sent-1',text:'A new separate thought.',direction:'out',at:Date.now()}];
    fixture.context.composerEmpty=true;
    (dom.window as any).renderFixture(); await tick();
    mic().click(); await tick();
    assert.equal(input.value,'','a matching sent message clears the old panel draft before recording again');
    mic().click(); await tick(); await tick();
    const syncs=requests.filter((r)=>r.type==='SYNC_MESSAGE');
    assert.equal(input.value,'A new separate thought.');
    assert.equal(syncs.at(-1).expectedText,'');
  } finally {(dom.window as any).root.unmount();dom.window.close();}
});

test("an old matching outgoing message does not clear a draft after a manual composer clear", async () => {
  const dom=new JSDOM('<div id="root"></div>',{url:'https://extension.test/panel.html?tabId=1',runScripts:'outside-only',pretendToBeVisual:true});
  (dom.window as any).fixture=state('human takeover');
  (dom.window as any).fixture.context.messages=[{id:'old-sent',text:'Same repeated wording.',direction:'out',at:Date.now()}];
  (dom.window as any).chrome={runtime:{id:'fixture',sendMessage:async(message:any)=>{
    if(message.type==='RECORD_AUDIO_STOP') return {ok:true,value:{audio:'AQIDBA==',mimeType:'audio/webm'}};
    if(message.type==='TRANSCRIBE_AUDIO') return {ok:true,value:{text:'Same repeated wording.'}};
    if(message.type==='SYNC_MESSAGE') return {ok:true,value:{synced:true,text:message.text}};
    return {ok:true,value:{}};
  }}};
  try {
    dom.window.eval(bundle); await tick();
    const mic=()=>dom.window.document.querySelector<HTMLButtonElement>('.speech-input__toggle')!;
    mic().click(); await tick(); mic().click(); await tick(); await tick();
    const input=dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!;
    assert.equal(input.value,'Same repeated wording.');
    mic().click(); await tick();
    assert.equal(input.value,'Same repeated wording.','the historical matching message is in the baseline outgoing set');
  } finally {(dom.window as any).root.unmount();dom.window.close();}
});

test("switching customers cancels an active recording and clears its transcript session", async () => {
  const dom = new JSDOM('<div id="root"></div>', {url: 'https://extension.test/panel.html?tabId=1', runScripts:'outside-only',pretendToBeVisual:true});
  const requests: any[] = [];
  (dom.window as any).fixture = state('human takeover');
  (dom.window as any).chrome = {runtime:{id:'fixture',sendMessage:async(message:any)=>{
    requests.push(message);
    if(message.type==='RECORD_AUDIO_STOP') return {ok:true,value:{audio:'AQIDBA==',mimeType:'audio/webm'}};
    if(message.type==='TRANSCRIBE_AUDIO') return {ok:true,value:{text:'This message is for the original chat.'}};
    return {ok:true,value:{}};
  }}};
  try {
    dom.window.eval(bundle);
    await tick();
    dom.window.document.querySelector<HTMLButtonElement>('.speech-input__toggle')!.click();
    await tick();
    const changed = state('group');
    changed.context = {...changed.context!,chatId:'other',name:'Other chat'};
    (dom.window as any).fixture = changed;
    (dom.window as any).renderFixture();
    await tick();
    assert.equal(requests.some((request)=>request.type==='SYNC_MESSAGE'),false);
    assert.ok(requests.some((request)=>request.type==='RECORD_AUDIO_CANCEL'));
    assert.equal(dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!.value,'');
  } finally {
    (dom.window as any).root.unmount();
    dom.window.close();
  }
});

const suggestionFor = (overrides: Record<string, unknown> = {}) => ({
  reply: "Hello! Here is the checklist you asked for.", needsHuman: false, reason: "", sources: [],
  chatId: "fixture", contextName: "Test customer", incomingId: null, createdAt: 1700000000000,
  placementReason: "panel-only", ...overrides,
});

test("customer switches clear customer-specific assistant state while same-chat refresh preserves edits", async () => {
  const dom = new JSDOM('<div id="root"></div>', {url:'https://extension.test/panel.html?tabId=1',runScripts:'outside-only',pretendToBeVisual:true});
  (dom.window as any).fixture=state('human takeover');
  (dom.window as any).fixture.draft=suggestionFor() as any;
  (dom.window as any).chrome={runtime:{id:'fixture',sendMessage:async()=>({ok:true,value:{}})}};
  try {
    dom.window.eval(bundle); await tick();
    assert.match(dom.window.document.body.textContent!,/checklist you asked for/);
    const input=dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(input,'private instruction for A');
    input.dispatchEvent(new dom.window.Event('input',{bubbles:true})); await tick();
    (dom.window as any).renderFixture(); await tick();
    assert.equal(dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!.value,'private instruction for A');
    const customerB=state('human takeover'); customerB.context={...customerB.context!,chatId:'customer-b',name:'Customer B'};
    (dom.window as any).fixture=customerB; (dom.window as any).renderFixture(); await tick();
    assert.equal(dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!.value,'');
    assert.equal(dom.window.document.querySelector('.draft-text'),null);
    customerB.context={...customerB.context!,chatId:'fixture',name:'Test customer'};
    customerB.draft=suggestionFor() as any;
    (dom.window as any).renderFixture(); await tick();
    assert.equal(dom.window.document.querySelector('.draft-text'),null,'A→B→A does not restore an earlier saved suggestion');
  } finally {(dom.window as any).root.unmount();dom.window.close();}
});

test("pending generation from the previous customer is ignored and a new request uses only the new instruction", async () => {
  const dom = new JSDOM('<div id="root"></div>', {url:'https://extension.test/panel.html?tabId=1',runScripts:'outside-only',pretendToBeVisual:true});
  const requests:any[]=[]; let finishOld:(value:any)=>void=()=>{};
  (dom.window as any).fixture=state('human takeover');
  (dom.window as any).chrome={runtime:{id:'fixture',sendMessage:(message:any)=>{
    requests.push(message);
    if(message.type==='GENERATE' && requests.filter((r)=>r.type==='GENERATE').length===1) return new Promise((resolve)=>{finishOld=resolve;});
    if(message.type==='GENERATE') return Promise.resolve({ok:true,value:suggestionFor({chatId:'customer-b',contextName:'Customer B',reply:'B only'})});
    return Promise.resolve({ok:true,value:{}});
  }}};
  try {
    dom.window.eval(bundle); await tick();
    const input=dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(input,'instruction for A');
    input.dispatchEvent(new dom.window.Event('input',{bubbles:true})); await tick();
    dom.window.document.querySelector<HTMLButtonElement>('.draft-button')!.click(); await tick();
    const customerB=state('human takeover'); customerB.context={...customerB.context!,chatId:'customer-b',name:'Customer B'};
    (dom.window as any).fixture=customerB; (dom.window as any).renderFixture(); await tick();
    assert.equal(dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!.value,'');
    finishOld({ok:true,value:suggestionFor({reply:'stale A result'})}); await tick(); await tick();
    assert.equal(dom.window.document.querySelector('.draft-text'),null);
    const inputB=dom.window.document.querySelector<HTMLTextAreaElement>('#assistant-instruction')!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(inputB,'new instruction for B');
    inputB.dispatchEvent(new dom.window.Event('input',{bubbles:true})); await tick();
    dom.window.document.querySelector<HTMLButtonElement>('.draft-button')!.click(); await tick(); await tick();
    const generateRequests=requests.filter((r)=>r.type==='GENERATE');
    assert.equal(generateRequests[0].expectedChatId,'fixture');
    assert.equal(generateRequests[1].expectedChatId,'customer-b');
    assert.equal(generateRequests[0].instruction,'instruction for A');
    assert.equal(generateRequests[1].instruction,'new instruction for B');
    assert.equal(dom.window.document.querySelector('.draft-text')!.textContent,'B only');
  } finally {(dom.window as any).root.unmount();dom.window.close();}
});

function mountAssistant(kind: string, handler: (message: any) => any, prepare: (fixture: DeskState) => void = () => {}) {
  const dom = new JSDOM('<div id="root"></div>', {url: 'https://extension.test/panel.html?tabId=1', runScripts: 'outside-only', pretendToBeVisual: true});
  const requests: any[] = [];
  const fixture = state(kind);
  prepare(fixture);
  (dom.window as any).fixture = fixture;
  (dom.window as any).chrome = {runtime: {id: 'fixture', sendMessage: async (message: any) => {
    requests.push(message);
    const value = await handler(message);
    return value && "ok" in value ? value : {ok: true, value};
  }}};
  dom.window.eval(bundle);
  const doc = dom.window.document;
  return {dom, doc, requests, fixture, insert: () => doc.querySelector<HTMLButtonElement>('.insert-button'), generate: async () => { doc.querySelector<HTMLButtonElement>('.draft-button')!.click(); await tick(); await tick(); }};
}
const writes = (requests: any[]) => requests.filter((r) => r.type === 'SYNC_MESSAGE');
const sends = (requests: any[]) => requests.filter((r) => /^(SEND|PLACE)/.test(r.type));

test("Insert into chat writes the suggestion once through compare-and-set and never sends", async () => {
  const m = mountAssistant("human takeover", (message) => message.type === 'GENERATE' ? suggestionFor() : message.type === 'SYNC_MESSAGE' ? {synced: true, text: message.text} : {});
  try {
    await tick(); await m.generate();
    assert.ok(m.insert(), "panel-only suggestion in an open chat offers Insert");
    m.insert()!.click(); await tick(); await tick();
    const syncs = writes(m.requests);
    assert.equal(syncs.length, 1);
    assert.equal(syncs[0].chatId, 'fixture');
    assert.equal(syncs[0].text, "Hello! Here is the checklist you asked for.");
    assert.equal(syncs[0].expectedText, '');
    assert.equal(sends(m.requests).length, 0);
    assert.match(m.doc.querySelector('[role="status"]')!.textContent!, /Added to WhatsApp — review and send there\./);
    assert.match(m.insert()!.textContent!, /Inserted/);
  } finally { (m.dom.window as any).root.unmount(); m.dom.window.close(); }
});

test("Insert into chat refuses an occupied composer without writing", async () => {
  const m = mountAssistant("occupied", (message) => message.type === 'GENERATE' ? suggestionFor() : {});
  try {
    await tick(); await m.generate();
    m.insert()!.click(); await tick();
    assert.equal(writes(m.requests).length, 0);
    assert.match([...m.doc.querySelectorAll('[role="alert"]')].map((e) => e.textContent).join(' '), /already has text/);
    assert.match(m.doc.querySelector('.draft-text')!.textContent!, /checklist/);
  } finally { (m.dom.window as any).root.unmount(); m.dom.window.close(); }
});

test("switching customers clears the prior customer's suggestion before it can be inserted", async () => {
  const m = mountAssistant("human takeover", (message) => message.type === 'GENERATE' ? suggestionFor() : {});
  try {
    await tick(); await m.generate();
    assert.equal(m.insert()!.disabled, false);
    m.fixture.context = {...m.fixture.context!, chatId: 'other', name: 'Other chat'};
    (m.dom.window as any).renderFixture(); await tick();
    assert.equal(m.doc.querySelector('.draft-text'), null);
    assert.equal(m.insert(), null);
    assert.equal(writes(m.requests).length, 0);
  } finally { (m.dom.window as any).root.unmount(); m.dom.window.close(); }
});

test("a changed WhatsApp composer during Insert shows the conflict once and does not retry", async () => {
  const m = mountAssistant("human takeover", (message) => message.type === 'GENERATE' ? suggestionFor() : message.type === 'SYNC_MESSAGE' ? {ok: false, error: 'The WhatsApp message changed. Review it before syncing again.'} : {});
  try {
    await tick(); await m.generate();
    m.insert()!.click(); await tick(); await tick(); await tick();
    assert.equal(writes(m.requests).length, 1);
    assert.match([...m.doc.querySelectorAll('[role="alert"]')].map((e) => e.textContent).join(' '), /already has text/);
    assert.doesNotMatch(m.doc.body.textContent!, /Inserted/);
  } finally { (m.dom.window as any).root.unmount(); m.dom.window.close(); }
});

test("Insert into chat is absent without a chat or for suggestions already placed by automation", async () => {
  const none = mountAssistant("no chat", (message) => message.type === 'GENERATE' ? suggestionFor() : {});
  try {
    await tick(); await none.generate();
    assert.match(none.doc.querySelector('.draft-text')!.textContent!, /checklist/);
    assert.equal(none.insert(), null);
  } finally { (none.dom.window as any).root.unmount(); none.dom.window.close(); }
  for (const placementReason of ["automatic-send", "chat-draft"]) {
    const auto = mountAssistant("human takeover", () => ({}), (fixture) => { fixture.draft = suggestionFor({placementReason}) as any; });
    try {
      await tick();
      assert.match(auto.doc.querySelector('.draft-text')!.textContent!, /checklist/);
      assert.equal(auto.insert(), null, placementReason);
    } finally { (auto.dom.window as any).root.unmount(); auto.dom.window.close(); }
  }
});

test("Cmd or Ctrl plus Enter asks the assistant; plain Enter does not", async () => {
  const m = mountAssistant("human takeover", (message) => message.type === 'GENERATE' ? suggestionFor() : {});
  try {
    await tick();
    const input = m.doc.querySelector<HTMLTextAreaElement>('#assistant-instruction')!;
    input.dispatchEvent(new m.dom.window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    await tick();
    assert.equal(m.requests.filter((r) => r.type === 'GENERATE').length, 0);
    input.dispatchEvent(new m.dom.window.KeyboardEvent('keydown', {key: 'Enter', ctrlKey: true, bubbles: true}));
    await tick(); await tick();
    assert.equal(m.requests.filter((r) => r.type === 'GENERATE').length, 1);
    assert.equal(m.requests.find((r) => r.type === 'GENERATE').assistOnly, true);
    input.dispatchEvent(new m.dom.window.KeyboardEvent('keydown', {key: 'Enter', metaKey: true, bubbles: true}));
    await tick(); await tick();
    assert.equal(m.requests.filter((r) => r.type === 'GENERATE').length, 2);
  } finally { (m.dom.window as any).root.unmount(); m.dom.window.close(); }
});
