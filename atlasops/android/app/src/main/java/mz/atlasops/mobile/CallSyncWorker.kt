package mz.atlasops.mobile

import android.Manifest
import android.app.role.RoleManager
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CallLog
import androidx.core.content.ContextCompat
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/** Logs are device-reported only. Never records or accesses audio. Corporate SIM filter is mandatory. */
class CallSyncWorker(context:Context,params:WorkerParameters):Worker(context,params){
 override fun doWork():Result {
  val role=applicationContext.getSystemService(RoleManager::class.java)
  if(!role.isRoleHeld(RoleManager.ROLE_DIALER))return Result.failure()
  if(ContextCompat.checkSelfPermission(applicationContext,Manifest.permission.READ_CALL_LOG)!=PackageManager.PERMISSION_GRANTED)return Result.failure()
  val corporateAccount=SecureStore.get(applicationContext,"phoneAccountId")
  val token=SecureStore.get(applicationContext,"deviceToken")
  if(corporateAccount.isNullOrBlank()||token.isNullOrBlank())return Result.failure()
  return try{
   val events=readCorporateCallEvents(corporateAccount)
   var index=0
   while(index<events.length()){
    val batch=JSONArray()
    for(n in index until minOf(index+100,events.length()))batch.put(events.getJSONObject(n))
    DeviceApi.post(applicationContext,"/device-api/calls",JSONObject().put("events",batch),token)
    index+=100
   }
   Result.success()
  }catch(e:Exception){
   android.util.Log.w("AtlasOpsSync","Call sync failed: ${e.javaClass.simpleName}") // No phone numbers or secrets in logs
   Result.retry()
  }
 }
 private fun readCorporateCallEvents(accountId:String):JSONArray {
  val projection=arrayOf(CallLog.Calls._ID,CallLog.Calls.NUMBER,CallLog.Calls.DATE,CallLog.Calls.DURATION,CallLog.Calls.TYPE,CallLog.Calls.PHONE_ACCOUNT_ID)
  val cutoff=System.currentTimeMillis()-30L*24L*60L*60L*1000L
  val result=JSONArray()
  val cursor=applicationContext.contentResolver.query(CallLog.Calls.CONTENT_URI,projection,
   "${CallLog.Calls.DATE} >= ?",arrayOf(cutoff.toString()),"${CallLog.Calls.DATE} ASC")?:return result
  cursor.use {c->
   val idxId=c.getColumnIndexOrThrow(CallLog.Calls._ID)
   val idxNumber=c.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
   val idxDate=c.getColumnIndexOrThrow(CallLog.Calls.DATE)
   val idxDuration=c.getColumnIndexOrThrow(CallLog.Calls.DURATION)
   val idxType=c.getColumnIndexOrThrow(CallLog.Calls.TYPE)
   val idxAccount=c.getColumnIndexOrThrow(CallLog.Calls.PHONE_ACCOUNT_ID)
   while(c.moveToNext()){
    // Fail closed: unknown account NEVER means "all SIMs".
    if(c.isNull(idxAccount)||c.getString(idxAccount)!=accountId)continue
    val raw=c.getString(idxNumber)?.replace(Regex("[\\s().-]"),"")?:continue
    if(raw.isBlank()||raw.equals("unknown",true)||raw.equals("private",true))continue
    val phone=if(raw.matches(Regex("8[0-9]{8}")))"+258$raw" else raw
    val direction=when(c.getInt(idxType)){
     CallLog.Calls.OUTGOING_TYPE->"outgoing"
     CallLog.Calls.INCOMING_TYPE->"incoming"
     CallLog.Calls.MISSED_TYPE->"missed"
     CallLog.Calls.REJECTED_TYPE->"rejected"
     else->continue
    }
    val duration=c.getLong(idxDuration).coerceIn(0,86400)
    result.put(JSONObject().put("externalId",c.getLong(idxId).toString())
     .put("remotePhoneE164",phone).put("direction",direction)
     .put("startedAt",Instant.ofEpochMilli(c.getLong(idxDate)).toString())
     .put("durationSeconds",duration))
   }
  }
  return result
 }
}
