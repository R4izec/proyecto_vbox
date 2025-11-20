'use strict';
const crypto = require('crypto');

const REGIONS = {
  cn: 'http://api.v-box.net',
  eu: 'http://api.eu.v-box.net',
  asean: 'http://api.asean.v-box.net',
};

const DEFAULT_SECRETKEY = 'f1cd9351930d4e589922edbcf3b09a7c';

const md5Hex   = (s) => crypto.createHash('md5').update(String(s), 'utf8').digest('hex');
const tsMillis = () => Date.now();
const norm     = (v) => (v === undefined || v === null ? '' : String(v).trim());
const pad2     = (n) => String(n).padStart(2, '0');
const pad3     = (n) => String(n).padStart(3, '0');

function buildSignString(params, secretkey) {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([k, v]) => [k, norm(v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const base = entries.map(([k, v]) => `${k}=${v}`).join('&');
  return `${base}&key=${secretkey}`;
}
function buildSign(params, secretkey) {
  const signString = buildSignString(params, secretkey);
  return { sign: md5Hex(signString), signString };
}

function formatWeconTime(t) {
  if (t === undefined || t === null || t === '') return '';
  let ms;
  if (typeof t === 'number') ms = t;
  else {
    const d = new Date(t);
    if (!Number.isFinite(d.getTime())) return String(t);
    ms = d.getTime();
  }
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`;
}

class VBoxClient {
  constructor({ comid, comkey, region = 'eu', base = '', secretkey = DEFAULT_SECRETKEY, debug = false } = {}) {
    this.comid     = norm(comid);
    this.comkey    = norm(comkey);
    this.secretkey = secretkey;
    this.baseURL   = norm(base) || REGIONS[region] || REGIONS.eu;
    this.sid       = null;
    this.debug     = !!debug || !!process.env.VBOX_DEBUG;
  }
  get apiBase() { return `${this.baseURL}/box-data/api`; }
  setSid(sid) { this.sid = norm(sid); }

  async _post(acturl, actParams = {}, { useSid = false } = {}) {
    const ts = tsMillis();
    const cleanParams = Object.fromEntries(Object.entries(actParams).map(([k, v]) => [k, norm(v)]));

    const signParams = {
      ...cleanParams,
      comid: this.comid,
      compvtkey: this.comkey,
      ts,
      ...(useSid && this.sid ? { sid: this.sid } : {}),
    };
    const { sign, signString } = buildSign(signParams, this.secretkey);

    const commonHeaderObj = {
      ...cleanParams,
      comid: this.comid,
      compvtkey: this.comkey,
      ts,
      sign,
      ...(useSid && this.sid ? { sid: this.sid } : {}),
    };

    if (this.debug) {
      console.log('[VBOX DEBUG] acturl:', acturl);
      console.log('[VBOX DEBUG] signString:', signString);
      console.log('[VBOX DEBUG] commonHeader:', JSON.stringify(commonHeaderObj));
    }

    const url = new URL(`${this.apiBase}/${acturl}`);
    for (const [k, v] of Object.entries(cleanParams)) if (v !== '') url.searchParams.append(k, v);

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { common: JSON.stringify(commonHeaderObj), 'Content-Type': 'application/json' },
    });

    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch {}
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (typeof data.code !== 'number' || data.code !== 200) throw new Error(`API error ${data.code}: ${data.msg || 'unknown'}`);
    return data.result || {};
  }

  async login({ alias, password }) {
    const passwordMd5 = md5Hex(norm(password));
    const result = await this._post('we-data/login', { alias: norm(alias), password: passwordMd5 });
    if (!result.sid) throw new Error('El login no devolvió SID');
    this.sid = result.sid;
    return result;
  }

  async getBoxes() {
    return await this._post('we-data/boxs', {}, { useSid: true });
  }

  async getRealtime({ boxId, keys = [] }) {
    const ks = Array.isArray(keys) ? keys.join(',') : String(keys || '');
    const result = await this._post('we-data/realdata', { boxId: String(boxId), keys: ks }, { useSid: true });
    return VBoxClient.normalizeRealtime(result);
  }

  async sendSwitchToDevice({ boxId }) {
    return await this._post('we-data/sendSwitchToDevice', { boxId: String(boxId) }, { useSid: true });
  }

  async getRealtimeCfgList({ boxId }) {
    const r = await this._post('we-data/monitors', { boxId: String(boxId) }, { useSid: true });
    return { cfgList: Array.isArray(r.list) ? r.list : [], list: Array.isArray(r.list) ? r.list : [] };
  }

  async getHistoricalMonitors({ boxId }) {
    const r = await this._post('we-data/monitors', { boxId: String(boxId || '') }, { useSid: true });
    const list = Array.isArray(r.list) ? r.list : [];
    return list.map(it => ({
      monitorId: it.monitorId || it.id,
      monitorName: it.monitorName || it.name,
      groupId: it.groupId, groupName: it.groupName, boxId: it.boxId || boxId,
    }));
  }

  async getHistoryData({ monitorId, begin, end, pageIndex = 15, pageSize = 500 }) {
    const params = {
      monitorId: String(monitorId),
      monitorBeginTime: formatWeconTime(begin),
      monitorEndTime: formatWeconTime(end),
      pageSize: String(pageSize),
      pageIndex: String(pageIndex),
    };
    const r = await this._post('we-data/historydata', params, { useSid: true });
    const list = Array.isArray(r.list) ? r.list : [];
    return {
      list: list.map(it => ({
        monitorTime: it.monitorTime ?? null,                
        monitorTime_show: it.monitorTime_show ?? null,       
        monitorName: it.monitorName,
        value: it.value ?? null,
        groupId: it.groupId, groupName: it.groupName,
        boxId: it.boxId
      })),
      totalPage: Number(r.totalPage || 1),
      totalRecord: Number(r.totalRecord || list.length || 0),
      currentPage: Number(r.currentPage || r.pageIndex || pageIndex),
    };
  }

  async getMonitors({ boxId }) { const list = await this.getHistoricalMonitors({ boxId }); return { list }; }
  async getHistoryDataPage(opts) { return this.getHistoryData(opts); }

  static normalizeRealtime(result) {
    const out = {};
    if (!result) return out;
    if (Array.isArray(result.list)) {
      for (const it of result.list) {
        const k = it.monitorName || it.name || it.key || it.monitor || it.tag || it.monitorId || it.monId || it.k;
        const v = it.value ?? it.val ?? it.v ?? it.data ?? null;
        if (k !== undefined && k !== null && k !== '') out[String(k)] = v;
      }
    }
    if (result.map && typeof result.map === 'object') Object.assign(out, result.map);
    if (result.data && typeof result.data === 'object') Object.assign(out, result.data);
    return out;
  }
}

module.exports = { VBoxClient };
