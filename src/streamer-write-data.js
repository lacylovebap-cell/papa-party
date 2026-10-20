// Keep read-only registry metadata out of the strict server mutation contract.
export function streamerWriteData(row, changes = {}) {
  const source = {...row, ...changes};
  return Object.fromEntries(['id','slug','display_name','home_title','subtitle','description','avatar_url','banner_url','active']
    .filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}
