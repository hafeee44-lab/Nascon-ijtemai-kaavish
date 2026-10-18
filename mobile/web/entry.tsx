import React from 'react';
import {createRoot} from 'react-dom/client';
import App from '../App';
import {setJson,secure} from '../src/storage';
async function start(){
 if(!localStorage.getItem('matchday:editorial-v1')){await setJson('ui_dark_mode',false);localStorage.setItem('matchday:editorial-v1','1');}
 await setJson('server',location.origin+'/backend');
 const demo=new URLSearchParams(location.search).get('demo');
 if(demo && ['organizer','manager','player','viewer','admin'].includes(demo)){
  try{
   const response=await fetch('/backend/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:demo+'@nascon.test',password:'Nascon@26'})});
   if(response.ok){const {token,user}=await response.json();await secure.set('token',token);await setJson('user',user);const boot=await fetch('/backend/api/v1/bootstrap',{headers:{Authorization:'Bearer '+token}});if(boot.ok)await setJson('bootstrap',await boot.json());history.replaceState({},'',location.pathname);}
  }catch{/* Show normal login if the local backend is unavailable. */}
 }
 createRoot(document.getElementById('root')!).render(<App/>);
}
start();
new EventSource('/events').addEventListener('reload',()=>location.reload());
