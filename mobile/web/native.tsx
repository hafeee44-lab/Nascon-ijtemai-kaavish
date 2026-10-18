export * from 'react-native-web';
// Browser adapters for the same app. Android continues using its native bridges.
// react-native-svg includes a lazy Android sound import in its web bundle.
// Native modules are unavailable in a browser; never substitute native behavior.
export const Linking = {
 getInitialURL:async()=>window.location.href,
 addEventListener:()=>({remove(){}}),
 openURL:async(url:string)=>{window.open(url,'_blank','noopener,noreferrer');},
};
export const TurboModuleRegistry = {
 get: (_name: string) => null,
 getEnforcing(name: string): never { throw new Error(`Native module ${name} is unavailable in the browser.`); }
};
export const NativeModules = {NasconStore: {
 getItem:async(k:string)=>localStorage.getItem('matchday:'+k),
 setItem:async(k:string,v:string)=>{localStorage.setItem('matchday:'+k,v);return true;},
 removeItem:async(k:string)=>{localStorage.removeItem('matchday:'+k);return true;},
 secureGet:async(k:string)=>sessionStorage.getItem('matchday:'+k),
 secureSet:async(k:string,v:string)=>{sessionStorage.setItem('matchday:'+k,v);return true;},
 secureRemove:async(k:string)=>{sessionStorage.removeItem('matchday:'+k);return true;},
 savePdf:async(name:string,b64:string)=>{const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return name;}
}};
export const Alert={alert(title:string,message:string,buttons:any[]=[{text:'OK'}]){
 const previous=document.activeElement as HTMLElement|null;
 const dialog=document.createElement('dialog');dialog.className='matchday-dialog';
 const heading=document.createElement('h2');heading.id='confirm-title';heading.textContent=title;dialog.setAttribute('aria-labelledby',heading.id);
 const copy=document.createElement('p');copy.textContent=message;
 const actions=document.createElement('div');actions.className='dialog-actions';
 buttons.forEach(b=>{const button=document.createElement('button');button.textContent=b.text;button.className=b.style==='cancel'?'secondary':b.style==='destructive'?'danger':'';button.onclick=()=>{dialog.close();dialog.remove();previous?.focus();b.onPress?.();};actions.append(button);});
 dialog.append(heading,copy,actions);document.body.append(dialog);dialog.addEventListener('cancel',()=>{dialog.remove();previous?.focus();});dialog.showModal();
}};
