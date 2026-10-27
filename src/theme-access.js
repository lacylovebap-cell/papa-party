// Theme feature authorization (pure). The Edge function is the only place that
// enforces these rules; the browser uses the same table only to grey out UI.
export const THEME_STREAMER_FEATURES=['theme_streamer_basic','theme_streamer_images','theme_streamer_publish'];
export const THEME_HALL_FEATURES=['theme_hall_basic','theme_hall_images','theme_hall_publish'];
export const THEME_FEATURE_LABELS={theme_streamer_basic:'主播配色與基本主題',theme_streamer_images:'主播背景、橫幅、卡片及裝飾圖片',theme_streamer_publish:'主播主題草稿與發布',theme_hall_basic:'廳首頁基本主題',theme_hall_images:'廳首頁圖片編輯',theme_hall_publish:'廳首頁草稿與發布'};
// The six confirmed plans. No prices are stored or shown anywhere.
export const THEME_PLANS=[
 ['lifetime_free_full','終身免費全功能',true],
 ['founding','創始會員',true],
 ['founding_lifetime','創始終身會員',true],
 ['basic_plus_single','基本免費＋單項新功能授權',false],
 ['general_full','一般全功能會員',true],
 ['free_songbook','免費歌本＋手動升級',false]
];
export const THEME_LOCKED_MESSAGE='此功能尚未開放，目前會員方案不包含此功能。如需使用，請聯絡平台管理員。';
const themePlanIds=new Set(THEME_PLANS.map(p=>p[0]));
const themeFullPlans=new Set(THEME_PLANS.filter(p=>p[2]).map(p=>p[0]));
export function themePlanFeatures(row,now=Date.now()){
 if(!row||!themePlanIds.has(row.plan)||row.status!=='active')return [];
 if(row.valid_until&&!(Date.parse(row.valid_until)>now))return [];
 if(themeFullPlans.has(row.plan))return [...THEME_STREAMER_FEATURES];
 // Plans 4 and 6 open only what the president ticked by hand.
 return (Array.isArray(row.features)?row.features:[]).filter(f=>THEME_STREAMER_FEATURES.includes(f));
}
export function themePlanInput(input){
 const v=input&&typeof input==='object'&&!Array.isArray(input)?input:null;
 if(!v||!themePlanIds.has(v.plan))throw Error('請選擇會員方案');
 if(!['active','suspended'].includes(v.status))throw Error('請選擇方案狀態');
 if(v.validUntil!==null&&v.validUntil!==undefined&&v.validUntil!==''&&(typeof v.validUntil!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.validUntil)||Number.isNaN(Date.parse(v.validUntil+'T23:59:59+08:00'))))throw Error('有效期限格式不正確');
 const features=Array.isArray(v.features)?[...new Set(v.features)]:[];
 if(features.some(f=>!THEME_STREAMER_FEATURES.includes(f)))throw Error('主播主題功能代碼不正確');
 return {plan:v.plan,status:v.status,valid_until:v.validUntil?v.validUntil+'T23:59:59+08:00':null,features};
}
// What a save needs, comparing the stored settings with the requested ones.
// Basic + publish are needed for any theme change; images only when the set of
// image files changes. Returns the missing feature keys (empty = allowed).
export function themeSaveRequirements(changes,granted,{hall=false}={}){
 const [basic,images,publish]=hall?THEME_HALL_FEATURES:THEME_STREAMER_FEATURES,need=new Set();
 if(changes.theme)need.add(basic).add(publish);
 if(changes.images)need.add(images);
 return [...need].filter(f=>!granted.includes(f));
}
