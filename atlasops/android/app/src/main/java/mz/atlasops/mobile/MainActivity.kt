package mz.atlasops.mobile

import android.Manifest
import android.app.Activity
import android.app.role.RoleManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.Spinner
import android.widget.TextView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class MainActivity:Activity(){
 private lateinit var status:TextView
 private val accounts=mutableListOf<PhoneAccountHandle>()
 override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);setContentView(R.layout.activity_main)
  status=findViewById(R.id.statusText)
  findViewById<EditText>(R.id.serverUrl).setText(SecureStore.get(this,"server")?:"")
  findViewById<Button>(R.id.roleButton).setOnClickListener { val mgr=getSystemService(RoleManager::class.java);if(!mgr.isRoleHeld(RoleManager.ROLE_DIALER)) startActivityForResult(mgr.createRequestRoleIntent(RoleManager.ROLE_DIALER),1) else show("Already the default phone app.") }
  findViewById<Button>(R.id.permissionsButton).setOnClickListener {
   if(!hasRole()){show("First become the default phone app.");return@setOnClickListener}
   val perms=mutableListOf(Manifest.permission.READ_CALL_LOG,Manifest.permission.CALL_PHONE,Manifest.permission.READ_PHONE_STATE)
   if(Build.VERSION.SDK_INT>=33)perms.add(Manifest.permission.POST_NOTIFICATIONS)
   ActivityCompat.requestPermissions(this,perms.toTypedArray(),100)
  }
  findViewById<Button>(R.id.enrollButton).setOnClickListener {enroll()}
  findViewById<Button>(R.id.saveAccountButton).setOnClickListener {
   val index=findViewById<Spinner>(R.id.accountSpinner).selectedItemPosition
   if(index !in accounts.indices){show("No corporate account selected.");return@setOnClickListener}
   SecureStore.put(this,"phoneAccountId",accounts[index].id)
   show("Company SIM account locked. Only matching call logs will sync.")
   scheduleSync()
  }
  findViewById<Button>(R.id.dialButton).setOnClickListener {dial()}
  findViewById<Button>(R.id.syncButton).setOnClickListener {
   if(!ready()){show("Complete enrollment, role, permission, and corporate SIM selection first.");return@setOnClickListener}
   WorkManager.getInstance(this).enqueue(OneTimeWorkRequestBuilder<CallSyncWorker>().build());show("Sync requested. Results appear in the web dashboard.")
  }
  intent?.data?.schemeSpecificPart?.let{findViewById<EditText>(R.id.phoneNumber).setText(it)}
  refreshAccounts()
 }
 override fun onResume(){super.onResume();refreshAccounts()}
 private fun hasRole()=getSystemService(RoleManager::class.java).isRoleHeld(RoleManager.ROLE_DIALER)
 private fun hasPermission()=ContextCompat.checkSelfPermission(this,Manifest.permission.READ_CALL_LOG)==PackageManager.PERMISSION_GRANTED
 private fun ready()=hasRole()&&hasPermission()&&SecureStore.get(this,"deviceToken")!=null&&SecureStore.get(this,"phoneAccountId")!=null
 private fun refreshAccounts(){
  val spinner=findViewById<Spinner>(R.id.accountSpinner);accounts.clear()
  if(hasRole()&&ContextCompat.checkSelfPermission(this,Manifest.permission.READ_PHONE_STATE)==PackageManager.PERMISSION_GRANTED){
   val telecom=getSystemService(TelecomManager::class.java)
   try{accounts.addAll(telecom.callCapablePhoneAccounts)}catch(_:SecurityException){}
   val labels=accounts.map{handle->"${telecom.getPhoneAccount(handle)?.label ?: "SIM"} (${handle.id.take(16)})"}
   spinner.adapter=ArrayAdapter(this,android.R.layout.simple_spinner_dropdown_item,labels)
   val selected=SecureStore.get(this,"phoneAccountId")
   val index=accounts.indexOfFirst{it.id==selected};if(index>=0)spinner.setSelection(index)
  }
 }
 private fun enroll(){
  val url=findViewById<EditText>(R.id.serverUrl).text.toString()
  val code=findViewById<EditText>(R.id.enrollmentCode).text.toString().trim()
  val server=try{DeviceApi.validateServerUrl(url)}catch(_:Exception){show("Enter a valid HTTPS server URL");return}
  if(code.length<30){show("Enter the one-time enrollment code");return}
  SecureStore.put(this,"server",server)
  show("Enrolling...")
  thread {
   try{
    val result=DeviceApi.post(this,"/device-api/enroll",org.json.JSONObject().put("enrollmentToken",code).put("osName","android"))
    SecureStore.put(this,"deviceToken",result.getString("deviceToken"))
    SecureStore.put(this,"deviceId",result.getString("deviceId"))
    runOnUiThread {findViewById<EditText>(R.id.enrollmentCode).text.clear();show("Enrolled. Select and lock the corporate SIM.");scheduleSync()}
   }catch(e:Exception){runOnUiThread{show("Enrollment failed: ${e.message?.take(130)}")}}
  }
 }
 private fun dial(){
  if(!hasRole()||ContextCompat.checkSelfPermission(this,Manifest.permission.CALL_PHONE)!=PackageManager.PERMISSION_GRANTED){show("Role and call permission required.");return}
  val number=findViewById<EditText>(R.id.phoneNumber).text.toString().trim()
  if(!number.matches(Regex("[+0-9]{5,20}"))){show("Enter a valid phone number.");return}
  val id=SecureStore.get(this,"phoneAccountId")
  val handle=accounts.firstOrNull{it.id==id}
  if(handle==null){show("Select the corporate SIM; personal SIM fallback is blocked.");return}
  val extras=Bundle().apply{putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE,handle)}
  try{getSystemService(TelecomManager::class.java).placeCall(Uri.fromParts("tel",number,null),extras)}
  catch(e:Exception){show("Could not place call: ${e.javaClass.simpleName}")}
 }
 private fun scheduleSync(){if(!ready())return
  val network=Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
  val work=PeriodicWorkRequestBuilder<CallSyncWorker>(15,TimeUnit.MINUTES).setConstraints(network).build()
  WorkManager.getInstance(this).enqueueUniquePeriodicWork("corporate-call-sync",ExistingPeriodicWorkPolicy.UPDATE,work)
 }
 private fun show(message:String){status.text=message}
}
