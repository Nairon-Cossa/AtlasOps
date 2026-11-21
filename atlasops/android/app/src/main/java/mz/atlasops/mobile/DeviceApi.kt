package mz.atlasops.mobile

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

object DeviceApi {
 fun validateServerUrl(input:String):String {
  val uri=URI(input.trim().trimEnd('/'))
  require(uri.scheme=="https" && uri.host!=null && uri.userInfo==null && uri.query==null && uri.fragment==null) { "Only valid HTTPS server URLs are allowed." }
  return uri.toString().trimEnd('/')
 }
 fun post(context:Context,path:String,payload:JSONObject,authorization:String?=null):JSONObject {
  val url=SecureStore.get(context,"server")?:error("No server configured")
  val conn=URL(url+"/api"+path).openConnection() as HttpURLConnection
  conn.requestMethod="POST";conn.connectTimeout=12000;conn.readTimeout=16000
  conn.setRequestProperty("Content-Type","application/json")
  conn.setRequestProperty("Accept","application/json")
  if(authorization!=null)conn.setRequestProperty("Authorization","Device $authorization")
  conn.doOutput=true
  try {
   conn.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
   val status=conn.responseCode
   val body=(if(status in 200..299)conn.inputStream else conn.errorStream)?.bufferedReader()?.use {it.readText()} ?: "{}"
   if(status !in 200..299)error("HTTP $status: ${JSONObject(body).optString("error","sync failed")}")
   return JSONObject(body)
  } finally { conn.disconnect() }
 }
}
