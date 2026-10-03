export async function loadCityContext(client,cityId,signal){
  const {data,error}=await client.functions.invoke('city-context',{body:{city_id:cityId},signal});
  if(error)throw new Error('Environmental data unavailable.');
  if(data?.version!==1||data.context_only!==true||data.city?.id!==cityId||!data.weather||!data.air_quality)throw new Error('Environmental data unavailable.');
  return data;
}
