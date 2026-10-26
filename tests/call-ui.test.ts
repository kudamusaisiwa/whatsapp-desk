import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { DEFAULT_SETTINGS, type DeskState } from "../src/types";

const bundle = (await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {CallRecorder} from './src/CallRecorder'; window.root=createRoot(document.getElementById('root')); window.renderFixture=()=>window.root.render(React.createElement(CallRecorder,{desk:window.fixture,visible:window.visible!==false,refresh:async()=>{},openSignal:window.openSignal,onStatusChange:(s)=>{(window.statuses=window.statuses||[]).push(s);}})); window.renderFixture();`,
    resolveDir: process.cwd(), loader: "tsx",
  },
  bundle: true, write: false, format: "iife", platform: "browser", define: { "process.env.NODE_ENV": '"production"' },
})).outputFiles[0].text;
const tick = () => new Promise((resolve) => setTimeout(resolve, 35));
const status = (overrides: Record<string, unknown> = {}) => ({
  phase: "recording", startedAt: Date.now(), durationMs: 4200, bytes: 1220,
  hasMicrophone: true, hasCallAudio: true, ...overrides,
});
function state(chatId: string | null = "chat-A"): DeskState {
  const context = chatId ? {chatId,name:chatId === "chat-A" ? "Original caller" : "Other caller",isGroup:false,messages:[],lastIncomingAt:null,lastIncomingId:null,composerEmpty:true,atBottom:true,observedAt:Date.now()} : null;
  return {settings:{...DEFAULT_SETTINGS},knowledge:[],clients:{},followUps:[],hasKey:true,models:[],context,draft:null,activity:"",replyTiming:null,inbox:null};
}
function setup(handler: (message: any) => any, initial: DeskState = state()) {
  const dom = new JSDOM('<div id="root"></div>', {url:"https://extension.test/panel.html?tabId=1",runScripts:"outside-only",pretendToBeVisual:true});
  (dom.window as any).fixture = initial;
  (dom.window as any).visible = true;
  (dom.window as any).chrome = {runtime:{id:"fixture",sendMessage:async(message:any) => {
    const response = await handler(message);
    return response && "ok" in response ? response : {ok:true,value:response};
  }}};
  dom.window.eval(bundle);
  return dom;
}

test("recording starts only after the click, shows both audio sources, then transcribes and syncs a call summary", async () => {
  const requests:any[]=[];
  const callStartedAt=Date.now()-90_000;
  let resolveStart:(value:any)=>void=()=>{};
  const startGate=new Promise((resolve)=>{resolveStart=resolve;});
  const dom=setup((message)=>{
    requests.push(message);
    if(message.type==="CALL_RECORD_START") return startGate;
    if(message.type==="CALL_RECORD_STOP") return {audio:"AQIDBA==",mimeType:"audio/webm",durationMs:5200,hasCallAudio:true,hasMicrophone:true};
    if(message.type==="CALL_RECORD_STATUS") return status({phase:"stopped",durationMs:5200});
    if(message.type==="TRANSCRIBE_CALL") return {text:"We agreed to send the registration checklist tomorrow."};
    if(message.type==="SUMMARIZE_CALL") return {text:"Send the registration checklist tomorrow."};
    if(message.type==="SYNC_MESSAGE") return {synced:true,text:message.text};
    return {};
  });
  try {
    await tick();
    assert.equal(requests.some((r)=>r.type==="CALL_RECORD_START"),false,"the picker must wait for the user's click");
    dom.window.document.querySelector<HTMLButtonElement>(".call-record-button")!.click(); await tick();
    assert.equal(requests[0].type,"CALL_RECORD_START");
    assert.equal(requests[0].chatId,"chat-A");
    assert.match(dom.window.document.body.textContent!,/Share audio/,"the picker hint shows while the share request is pending");
    resolveStart({sessionId:"call-1",chatId:"chat-A",name:"Original caller",startedAt:callStartedAt}); await tick();
    assert.match(dom.window.document.body.textContent!,/Original caller/);
    assert.match(dom.window.document.body.textContent!,/Recording call audio and your microphone/);
    assert.match(dom.window.document.body.textContent!,/Call audio connected/);
    assert.match(dom.window.document.body.textContent!,/Microphone connected/);
    const companyInput=dom.window.document.querySelector<HTMLInputElement>("[aria-label='Company speaker']");
    const customerInput=dom.window.document.querySelector<HTMLInputElement>("[aria-label='Customer speaker']");
    assert.ok(companyInput,"the company speaker input is offered for the call");
    assert.ok(customerInput,"the customer speaker input is offered for the call");
    assert.equal(customerInput!.value,"Original caller","the customer speaker is pre-filled with the chat name");
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,"value")!.set!.call(companyInput!,"Kuda");
    companyInput!.dispatchEvent(new dom.window.Event("input",{bubbles:true})); await tick();
    (dom.window as any).visible=false; (dom.window as any).renderFixture(); await tick();
    await new Promise((resolve)=>setTimeout(resolve,2050));
    assert.ok(requests.some((r)=>r.type==="CALL_RECORD_STATUS"),"recording status polling continues while the panel tab is hidden");
    (dom.window as any).visible=true; (dom.window as any).renderFixture(); await tick();
    dom.window.document.querySelector<HTMLButtonElement>(".call-stop-button")!.click(); await tick(); await tick();
    assert.equal(requests.some((r)=>r.type==="TRANSCRIBE_CALL"),true);
    const transcribe=requests.find((r)=>r.type==="TRANSCRIBE_CALL");
    assert.equal(transcribe.name,"Original caller");
    assert.equal(transcribe.speakers?.business,"Kuda","transcription carries the entered company speaker");
    assert.equal(transcribe.speakers?.customer,"Original caller","transcription carries the customer speaker");
    assert.equal(dom.window.document.querySelector<HTMLTextAreaElement>("[aria-label='Call transcript']")!.value,"We agreed to send the registration checklist tomorrow.");
    assert.equal(dom.window.document.querySelector(".call-try-again"),null,"successful transcription releases the retry audio buffer");
    dom.window.document.querySelector<HTMLButtonElement>(".call-summarize-button")!.click(); await tick(); await tick();
    const summarize=requests.find((r)=>r.type==="SUMMARIZE_CALL");
    assert.equal(summarize.name,"Original caller");
    assert.equal(summarize.chatId,"chat-A");
    assert.equal(summarize.startedAt,callStartedAt);
    assert.equal(summarize.text,"We agreed to send the registration checklist tomorrow.");
    assert.equal(summarize.speakers?.business,"Kuda","summarization carries the entered company speaker");
    assert.equal(summarize.speakers?.customer,"Original caller","summarization carries the customer speaker");
    const sync=requests.find((r)=>r.type==="SYNC_MESSAGE");
    assert.equal(sync.chatId,"chat-A");
    assert.equal(sync.expectedText,"");
    assert.equal(sync.text,"Send the registration checklist tomorrow.");
    assert.equal(requests.some((r)=>r.type==="SEND_MESSAGE"||r.type==="PLACE_MESSAGE"),false);
    const stopIndex=requests.findIndex((r)=>r.type==="CALL_RECORD_STOP");
    assert.equal(requests.slice(stopIndex+1).some((r)=>r.type==="CALL_RECORD_STATUS"),false,"STOP returns final capture flags and releases the status session");
    assert.match(dom.window.document.body.textContent!,/review and send there/i);
  } finally { (dom.window as any).root.unmount(); dom.window.close(); }
});

test("call recording uses call transcription readiness even when the text provider is disconnected", async () => {
  const requests: any[] = [];
  const configured = state();
  configured.hasKey = false;
  configured.providerStatus = { openai: true, openrouter: false };
  configured.settings.aiRoutes = {
    text: { provider: "openrouter", model: "custom/chat" },
    callStt: { provider: "openai", model: "whisper-1" },
  };
  const dom = setup((message) => {
    requests.push(message);
    return {};
  }, configured);
  try {
    await tick();
    const record = dom.window.document.querySelector<HTMLButtonElement>(".call-record-button")!;
    assert.equal(record.disabled, false, "a disconnected text route does not disable configured call STT");
    record.click();
    await tick();
    assert.equal(requests.some((request) => request.type === "CALL_RECORD_START"), true);
  } finally { (dom.window as any).root.unmount(); dom.window.close(); }
});

test("tab picker denial leaves earlier notes intact and does not claim a recording", async () => {
  const dom=setup((message)=>{
    if(message.type==="CALL_RECORD_START") return {ok:false,error:"Tab sharing was cancelled."};
    return {};
  });
  try {
    await tick();
    dom.window.document.querySelector<HTMLButtonElement>(".call-record-button")!.click(); await tick();
    assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!,/cancelled/);
    assert.equal(dom.window.document.querySelector(".call-stop-button"),null);
  } finally { (dom.window as any).root.unmount(); dom.window.close(); }
});

test("one missing audio source prevents transcription", async () => {
  const requests:any[]=[];
  const dom=setup((message)=>{
    requests.push(message);
    if(message.type==="CALL_RECORD_START") return {sessionId:"call-2",chatId:"chat-A",name:"Original caller",startedAt:Date.now()};
    if(message.type==="CALL_RECORD_STOP") return {audio:"AQIDBA==",mimeType:"audio/webm",durationMs:3000,hasCallAudio:false,hasMicrophone:true};
    return {};
  });
  try {
    await tick(); dom.window.document.querySelector<HTMLButtonElement>(".call-record-button")!.click(); await tick();
    dom.window.document.querySelector<HTMLButtonElement>(".call-stop-button")!.click(); await tick(); await tick();
    assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!,/Both call audio and microphone/);
    assert.equal(requests.some((r)=>r.type==="TRANSCRIBE_CALL"),false);
  } finally { (dom.window as any).root.unmount(); dom.window.close(); }
});

test("switching customers clears the completed transcript and summary, including on return to the original customer", async () => {
  const requests:any[]=[];
  const dom=setup((message)=>{
    requests.push(message);
    if(message.type==="CALL_RECORD_START") return {sessionId:"call-3",chatId:"chat-A",name:"Original caller",startedAt:Date.now()};
    if(message.type==="CALL_RECORD_STOP") return {audio:"AQIDBA==",mimeType:"audio/webm",durationMs:3000};
    if(message.type==="CALL_RECORD_STATUS") return status({phase:"stopped"});
    if(message.type==="TRANSCRIBE_CALL") return {text:"Call the customer after receiving the signed form."};
    if(message.type==="SUMMARIZE_CALL") return {text:"Call the customer after the signed form arrives."};
    if(message.type==="SYNC_MESSAGE") return {synced:true,text:message.text};
    return {};
  });
  try {
    await tick(); dom.window.document.querySelector<HTMLButtonElement>(".call-record-button")!.click(); await tick();
    dom.window.document.querySelector<HTMLButtonElement>(".call-stop-button")!.click(); await tick(); await tick();
    assert.equal(dom.window.document.querySelector<HTMLTextAreaElement>("[aria-label='Call transcript']")!.value,"Call the customer after receiving the signed form.");
    dom.window.document.querySelector<HTMLButtonElement>(".call-summarize-button")!.click(); await tick(); await tick();
    assert.equal(dom.window.document.querySelector<HTMLTextAreaElement>("#call-action-note")!.value,"Call the customer after the signed form arrives.");
    assert.equal(requests.find((r)=>r.type==="SYNC_MESSAGE").chatId,"chat-A","the completed note remains in its original WhatsApp chat");
    const other=state("chat-B"); (dom.window as any).fixture=other; (dom.window as any).renderFixture(); await tick();
    assert.equal(dom.window.document.querySelector("[aria-label='Call transcript']"),null);
    assert.equal(dom.window.document.querySelector("#call-action-note"),null);
    assert.equal(dom.window.document.querySelector(".call-recorder-origin"),null);
    assert.equal(dom.window.document.querySelector<HTMLButtonElement>(".call-record-button")!.textContent,"Record call");
    (dom.window as any).fixture=state("chat-A"); (dom.window as any).renderFixture(); await tick();
    assert.equal(dom.window.document.querySelector("[aria-label='Call transcript']"),null,"returning to A starts a clean call-note session");
    assert.equal(dom.window.document.querySelector("#call-action-note"),null);
  } finally { (dom.window as any).root.unmount(); dom.window.close(); }
});

test("an active call remains during same-customer refresh, then cancels and clears when the customer closes", async () => {
  const requests:any[]=[];
  const dom=setup((message)=>{
    requests.push(message);
    if(message.type==="CALL_RECORD_START") return {sessionId:"call-switch",chatId:"chat-A",name:"Original caller",startedAt:Date.now()};
    if(message.type==="CALL_RECORD_CANCEL") return {};
    return {};
  });
  try {
    await tick();
    dom.window.document.querySelector<HTMLButtonElement>(".call-record-button")!.click(); await tick();
    assert.ok(dom.window.document.querySelector(".call-stop-button"));
    (dom.window as any).fixture=state("chat-A"); (dom.window as any).renderFixture(); await tick();
    assert.ok(dom.window.document.querySelector(".call-stop-button"),"same-chat refresh preserves an active call");
    (dom.window as any).fixture=state(null); (dom.window as any).renderFixture(); await tick();
    assert.equal(dom.window.document.querySelector(".call-stop-button"),null);
    assert.equal(dom.window.document.querySelector(".call-transcript-details"),null);
    assert.equal(dom.window.document.querySelector(".call-summary-block"),null);
    assert.ok(requests.some((r)=>r.type==="CALL_RECORD_CANCEL" && r.sessionId==="call-switch"));
    assert.equal(dom.window.document.querySelector<HTMLButtonElement>(".call-record-button")!.disabled,true);
    (dom.window as any).fixture=state("chat-A"); (dom.window as any).renderFixture(); await tick();
    assert.equal(dom.window.document.querySelector(".call-stop-button"),null);
    assert.equal(dom.window.document.querySelector(".call-transcript-details"),null);
  } finally { (dom.window as any).root.unmount(); dom.window.close(); }
});

test("a stop that finishes after a customer switch is discarded without starting transcription", async () => {
  const requests:any[]=[]; let finishStop:(value:any)=>void=()=>{};
  const dom=setup((message)=>{
    requests.push(message);
    if(message.type==="CALL_RECORD_START") return {sessionId:"call-stop-switch",chatId:"chat-A",name:"Original caller",startedAt:Date.now()};
    if(message.type==="CALL_RECORD_STOP") return new Promise((resolve)=>{finishStop=resolve;});
    if(message.type==="CALL_RECORD_CANCEL") return {};
    return {};
  });
  try {
    await tick(); dom.window.document.querySelector<HTMLButtonElement>(".call-record-button")!.click(); await tick();
    dom.window.document.querySelector<HTMLButtonElement>(".call-stop-button")!.click(); await tick();
    (dom.window as any).fixture=state("chat-B"); (dom.window as any).renderFixture(); await tick();
    finishStop({audio:"AQIDBA==",mimeType:"audio/webm",durationMs:3000,hasCallAudio:true,hasMicrophone:true}); await tick(); await tick();
    assert.equal(requests.some((r)=>r.type==="TRANSCRIBE_CALL"),false);
    assert.equal(dom.window.document.querySelector("[aria-label='Call transcript']"),null);
    assert.equal(dom.window.document.querySelector("#call-action-note"),null);
  } finally { (dom.window as any).root.unmount(); dom.window.close(); }
});

test("a transcription resolving after a customer switch cannot show or summarize the old call", async () => {
  const requests:any[]=[]; let finishTranscription:(value:any)=>void=()=>{};
  const dom=setup((message)=>{
    requests.push(message);
    if(message.type==="CALL_RECORD_START") return {sessionId:"call-transcribe-switch",chatId:"chat-A",name:"Original caller",startedAt:Date.now()};
    if(message.type==="CALL_RECORD_STOP") return {audio:"AQIDBA==",mimeType:"audio/webm",durationMs:3000,hasCallAudio:true,hasMicrophone:true};
    if(message.type==="TRANSCRIBE_CALL") return new Promise((resolve)=>{finishTranscription=resolve;});
    return {};
  });
  try {
    await tick(); dom.window.document.querySelector<HTMLButtonElement>(".call-record-button")!.click(); await tick();
    dom.window.document.querySelector<HTMLButtonElement>(".call-stop-button")!.click(); await tick();
    await tick();
    assert.ok(requests.some((r)=>r.type==="TRANSCRIBE_CALL"));
    (dom.window as any).fixture=state("chat-B"); (dom.window as any).renderFixture(); await tick();
    finishTranscription({text:"Private transcript from A."}); await tick(); await tick();
    assert.equal(dom.window.document.querySelector("[aria-label='Call transcript']"),null);
    assert.equal(dom.window.document.querySelector(".call-summarize-button"),null);
    assert.equal(requests.some((r)=>r.type==="SYNC_MESSAGE"),false);
    (dom.window as any).fixture=state("chat-A"); (dom.window as any).renderFixture(); await tick();
    assert.equal(dom.window.document.querySelector("[aria-label='Call transcript']"),null);
  } finally { (dom.window as any).root.unmount(); dom.window.close(); }
});

test("a summary resolving after a customer switch cannot show or sync the old call note", async () => {
  const requests:any[]=[]; let finishSummary:(value:any)=>void=()=>{};
  const dom=setup((message)=>{
    requests.push(message);
    if(message.type==="CALL_RECORD_START") return {sessionId:"call-summary-switch",chatId:"chat-A",name:"Original caller",startedAt:Date.now()};
    if(message.type==="CALL_RECORD_STOP") return {audio:"AQIDBA==",mimeType:"audio/webm",durationMs:3000,hasCallAudio:true,hasMicrophone:true};
    if(message.type==="TRANSCRIBE_CALL") return {text:"We agreed to send the checklist."};
    if(message.type==="SUMMARIZE_CALL") return new Promise((resolve)=>{finishSummary=resolve;});
    return {};
  });
  try {
    await tick(); dom.window.document.querySelector<HTMLButtonElement>(".call-record-button")!.click(); await tick();
    dom.window.document.querySelector<HTMLButtonElement>(".call-stop-button")!.click(); await tick(); await tick();
    dom.window.document.querySelector<HTMLButtonElement>(".call-summarize-button")!.click(); await tick();
    (dom.window as any).fixture=state("chat-B"); (dom.window as any).renderFixture(); await tick();
    finishSummary({text:"Stale summary from A."}); await tick(); await tick();
    assert.equal(dom.window.document.querySelector("#call-action-note"),null);
    assert.equal(requests.some((r)=>r.type==="SYNC_MESSAGE"),false);
    (dom.window as any).fixture=state("chat-A"); (dom.window as any).renderFixture(); await tick();
    assert.equal(dom.window.document.querySelector("#call-action-note"),null);
  } finally { (dom.window as any).root.unmount(); dom.window.close(); }
});

test("editing an existing note while regenerating the summary preserves the edit and skips the stale sync", async () => {
  const requests:any[]=[];
  let finishSummary:(value:any)=>void=()=>{};
  let summaries=0;
  const dom=setup((message)=>{
    requests.push(message);
    if(message.type==="CALL_RECORD_START") return {sessionId:"call-edit",chatId:"chat-A",name:"Original caller",startedAt:Date.now()};
    if(message.type==="CALL_RECORD_STOP") return {audio:"AQIDBA==",mimeType:"audio/webm",durationMs:3000,hasCallAudio:true,hasMicrophone:true};
    if(message.type==="TRANSCRIBE_CALL") return {text:"Book the site visit for Friday."};
    if(message.type==="SUMMARIZE_CALL") {
      summaries++;
      return summaries===1 ? {text:"Book the site visit for Friday."} : new Promise((resolve)=>{finishSummary=resolve;});
    }
    if(message.type==="SYNC_MESSAGE") return {synced:true,text:message.text};
    return {};
  });
  try {
    await tick(); dom.window.document.querySelector<HTMLButtonElement>(".call-record-button")!.click(); await tick();
    dom.window.document.querySelector<HTMLButtonElement>(".call-stop-button")!.click(); await tick(); await tick();
    dom.window.document.querySelector<HTMLButtonElement>(".call-summarize-button")!.click(); await tick(); await tick();
    assert.equal(requests.filter((r)=>r.type==="SYNC_MESSAGE").length,1);
    const transcriptDetails=dom.window.document.querySelector<HTMLDetailsElement>(".call-transcript-details")!;
    transcriptDetails.open=true;
    const transcriptInput=transcriptDetails.querySelector<HTMLTextAreaElement>("textarea")!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,"value")!.set!.call(transcriptInput,"Book the site visit for Monday instead.");
    transcriptInput.dispatchEvent(new dom.window.Event("input",{bubbles:true})); await tick();
    dom.window.document.querySelector<HTMLButtonElement>(".call-summarize-button")!.click(); await tick();
    const note=dom.window.document.querySelector<HTMLTextAreaElement>("#call-action-note")!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,"value")!.set!.call(note,"Keep my newer action note.");
    note.dispatchEvent(new dom.window.Event("input",{bubbles:true})); await tick();
    finishSummary({text:"Stale generated replacement."}); await tick(); await tick();
    assert.equal(note.value,"Keep my newer action note.");
    assert.equal(requests.filter((r)=>r.type==="SYNC_MESSAGE").length,1,"stale re-summary cannot initiate another WhatsApp sync");
  } finally { (dom.window as any).root.unmount(); dom.window.close(); }
});

test("a summary resolving after unmount does not insert a call note", async () => {
  let finishSummary:(value:any)=>void=()=>{};
  const requests:any[]=[];
  const dom=setup((message)=>{
    requests.push(message);
    if(message.type==="CALL_RECORD_START") return {sessionId:"call-unmount",chatId:"chat-A",name:"Original caller",startedAt:Date.now()};
    if(message.type==="CALL_RECORD_STOP") return {audio:"AQIDBA==",mimeType:"audio/webm",durationMs:3000,hasCallAudio:true,hasMicrophone:true};
    if(message.type==="TRANSCRIBE_CALL") return {text:"Send the quote on Tuesday."};
    if(message.type==="SUMMARIZE_CALL") return new Promise((resolve)=>{finishSummary=resolve;});
    if(message.type==="SYNC_MESSAGE") return {synced:true,text:message.text};
    return {};
  });
  try {
    await tick(); dom.window.document.querySelector<HTMLButtonElement>(".call-record-button")!.click(); await tick();
    dom.window.document.querySelector<HTMLButtonElement>(".call-stop-button")!.click(); await tick(); await tick();
    dom.window.document.querySelector<HTMLButtonElement>(".call-summarize-button")!.click(); await tick();
    (dom.window as any).root.unmount();
    finishSummary({text:"Send the quote on Tuesday."}); await tick(); await tick();
    assert.equal(requests.some((r)=>r.type==="SYNC_MESSAGE"),false);
  } finally { dom.window.close(); }
});

test("cancel and panel unmount release an active recording", async () => {
  const cancelled:string[]=[];
  const dom=setup((message)=>{
    if(message.type==="CALL_RECORD_START") return {sessionId:"call-cancel",chatId:"chat-A",name:"Original caller",startedAt:Date.now()};
    if(message.type==="CALL_RECORD_CANCEL") {cancelled.push(message.sessionId);return {};}
    return {};
  });
  try {
    await tick(); dom.window.document.querySelector<HTMLButtonElement>(".call-record-button")!.click(); await tick();
    dom.window.document.querySelector<HTMLButtonElement>(".call-record-actions .text-button")!.click(); await tick();
    assert.deepEqual(cancelled,["call-cancel"]);
    dom.window.document.querySelector<HTMLButtonElement>(".call-record-button")!.click(); await tick();
    (dom.window as any).root.unmount(); await tick();
    assert.deepEqual(cancelled,["call-cancel","call-cancel"]);
  } finally { dom.window.close(); }
});


test("openSignal expands the collapsed body and the phase is reported to the host", async () => {
  const dom=setup((message)=>{
    if(message.type==="CALL_RECORD_START") return {sessionId:"call-signal",chatId:"chat-A",name:"Original caller",startedAt:Date.now()};
    return {};
  });
  try {
    await tick();
    assert.equal(dom.window.document.querySelector(".call-recorder-body"),null,"idle panel starts as a single compact row");
    assert.ok(dom.window.document.querySelector(".call-record-button"),"the record action stays in the compact row");
    (dom.window as any).openSignal=1; (dom.window as any).renderFixture(); await tick();
    assert.ok(dom.window.document.querySelector(".call-recorder-body"));
    assert.equal((dom.window as any).statuses[0].phase,"idle");
    dom.window.document.querySelector<HTMLButtonElement>(".call-record-button")!.click(); await tick();
    const statuses=(dom.window as any).statuses;
    assert.equal(statuses.at(-1).phase,"recording");
    assert.equal(statuses.at(-1).name,"Original caller");
    assert.equal(typeof statuses.at(-1).startedAt,"number");
  } finally { (dom.window as any).root.unmount(); dom.window.close(); }
});
