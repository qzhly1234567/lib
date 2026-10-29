// 前后端共用的公开表配置。禁止在此保存 Token 或其他密钥。
(function(root){
const tables={
 suppliers:{title:'询价厂家信息',short:'厂家',add:'添加询价厂家',eyebrow:'SUPPLIER DIRECTORY',description:'汇聚厂家与联系人信息，让每一次询价更高效。',fields:[
 {key:'system',label:'系统',required:true,optionsSource:{table:'系统',column:'名称'},placeholder:'如：给排水系统'},
 {key:'name',label:'设备名称',required:true,placeholder:'如：离心泵'},
 {key:'brand',label:'品牌（供货厂家）',required:true,placeholder:'请输入品牌或供货厂家'},
 {key:'contact',label:'联系人',required:true,placeholder:'请输入联系人姓名'},
 {key:'phone',label:'联系电话',required:true,type:'tel',placeholder:'请输入联系电话'},
 {key:'remark',label:'备注',wide:true,textarea:true,placeholder:'补充供货范围、询价说明等信息（选填）'}]},
 equipment:{title:'设备信息',short:'设备',add:'添加设备信息',eyebrow:'EQUIPMENT DIRECTORY',description:'集中记录设备规格与购置信息，快速找到所需设备。',fields:[
 {key:'category',label:'设备分类',required:true,optionsSource:{table:'设备分类',column:'名称'},placeholder:'如：水泵设备'},
 // 前端暂不展示设备类别；恢复时移除 hidden: true。后端继续保留此字段。
 {key:'subcategory',label:'设备类别',hidden:true,required:false,placeholder:'请输入设备分类下的具体类别（选填）'},
 {key:'name',label:'设备名称',required:true,placeholder:'请输入设备名称'},
 {key:'spec',label:'规格/参数',placeholder:'如：流量 25m³/h，扬程 32m'},
 {key:'material',label:'材质',placeholder:'如：304 不锈钢'},
 {key:'price',label:'购置单价（元）',type:'number',placeholder:'请输入购置单价',hint:'选填，金额最多保留两位小数，且不能为负数'},
 {key:'remark',label:'备注',wide:true,textarea:true,placeholder:'补充设备用途、安装要求等信息（选填）'}]}
};
const serverConfig={suppliers:{table:'询价厂家信息',env:'SEATABLE_SUPPLIERS_TABLE'},equipment:{table:'设备信息',env:'SEATABLE_EQUIPMENT_TABLE'}};
for(const [key,table]of Object.entries(tables)){
 Object.assign(table,serverConfig[key]);
 for(const field of table.fields){
  field.column=field.column||(field.key==='brand'?'品牌（供货厂家）':field.label);
  field.type=field.type||(field.textarea?'textarea':'text');
  field.required=Boolean(field.required);
  field.max=field.max??(field.key==='remark'?1000:field.key==='phone'?40:200);
  field.filter=field.filter??(field.key!=='remark');
 }
}
if(typeof module==='object'&&module.exports)module.exports=tables;
else root.TABLE_SCHEMAS=tables;
})(typeof window==='undefined'?globalThis:window);
