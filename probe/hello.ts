// Deploy-mechanism probe only: proves a stub can import a pinned module from this repo. No data, no secrets.
import webpush from 'npm:web-push@3.6.7';
Deno.serve(()=>new Response(JSON.stringify({probe:'ok',webpush:typeof webpush?.sendNotification}),{headers:{'content-type':'application/json'}}));
