'use strict'
const {normalize}=require('./lib/settings')
module.exports=function migrate(from,to,settings){return normalize(settings)}
