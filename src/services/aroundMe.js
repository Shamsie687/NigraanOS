import {validateAroundMe} from '../utils/aroundMe.js';
import {gridRows,gridColumns} from '../config/aroundMe.js';
export async function readAroundMe(client,query,{signal}={}){
  if(!Number.isInteger(query.row)||query.row<0||query.row>=gridRows||!Number.isInteger(query.column)||query.column<0||query.column>=gridColumns)throw new Error('Choose an area inside Around Me coverage.');
  let request=client.rpc('nigraan_around_me',{cell_row:query.row,cell_column:query.column});
  if(signal)request=request.abortSignal(signal);
  const {data,error}=await request;if(error)throw error;return validateAroundMe(data,query);
}
