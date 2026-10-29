// 集中字段配置：与 SeaTable 列名保持一致。此文件公开，禁止放入密钥。
(function (root) {
  const fields = [
    { key: 'name', column: '姓名', label: '姓名', type: 'text', max: 80, required: true, autocomplete: 'name', placeholder: '请输入你的姓名', hint: '请填写真实姓名，方便识别和联系' },
    { key: 'phone', column: '电话', label: '联系电话', type: 'tel', max: 40, required: true, autocomplete: 'tel', placeholder: '请输入联系电话', hint: '支持手机号或固定电话' }
  ];
  if (typeof module === 'object' && module.exports) module.exports = fields;
  else root.FIELD_SCHEMA = fields;
})(typeof window === 'undefined' ? globalThis : window);
