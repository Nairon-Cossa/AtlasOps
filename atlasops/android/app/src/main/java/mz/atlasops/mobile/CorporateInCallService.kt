package mz.atlasops.mobile

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.telecom.Call
import android.telecom.InCallService
import android.telecom.VideoProfile
import android.widget.Toast
import androidx.core.content.ContextCompat
import java.util.concurrent.CopyOnWriteArraySet

/** Basic Telecom integration. Test emergency, dual-SIM, lock screen, Bluetooth, and OEM behavior before deployment. */
object CallCoordinator {
 var service:CorporateInCallService?=null
 private val calls=mutableListOf<Call>()
 private val listeners=CopyOnWriteArraySet<()->Unit>()
 val active:Call? get()=calls.firstOrNull{it.state==Call.STATE_RINGING}?:calls.firstOrNull{it.state!=Call.STATE_DISCONNECTED}
 fun added(call:Call){calls.add(call);notifyChanged()}
 fun removed(call:Call){calls.remove(call);notifyChanged()}
 fun subscribe(listener:()->Unit){listeners.add(listener);listener()}
 fun unsubscribe(listener:()->Unit){listeners.remove(listener)}
 fun notifyChanged(){listeners.forEach{it.invoke()}}
}
class CorporateInCallService:InCallService(){
 private val callbacks=mutableMapOf<Call,Call.Callback>()
 override fun onCreate(){super.onCreate();CallCoordinator.service=this
  getSystemService(NotificationManager::class.java).createNotificationChannel(
   NotificationChannel("atlasops-calls","Corporate calls",NotificationManager.IMPORTANCE_HIGH))
 }
 override fun onCallAdded(call:Call){super.onCallAdded(call)
  CallCoordinator.added(call)
  val callback=object:Call.Callback(){override fun onStateChanged(call:Call,state:Int){CallCoordinator.notifyChanged();if(state==Call.STATE_DISCONNECTED)cancelNotification()}}
  call.registerCallback(callback);callbacks[call]=callback
  notifyCall(call)
 }
 override fun onCallRemoved(call:Call){callbacks.remove(call)?.let{call.unregisterCallback(it)};CallCoordinator.removed(call);cancelNotification();super.onCallRemoved(call)}
 override fun onDestroy(){CallCoordinator.service=null;super.onDestroy()}
 private fun cancelNotification(){getSystemService(NotificationManager::class.java).cancel(707)}
 private fun notifyCall(call:Call){
  val intent=Intent(this,CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
  val pi=PendingIntent.getActivity(this,0,intent,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  val incoming=call.state==Call.STATE_RINGING
  val notification=Notification.Builder(this,"atlasops-calls")
   .setSmallIcon(android.R.drawable.sym_action_call)
   .setContentTitle(if(incoming)"Incoming company call" else "Company call in progress")
   .setContentText("Tap to manage your phone call")
   .setCategory(Notification.CATEGORY_CALL)
   .setOngoing(true).setContentIntent(pi).setFullScreenIntent(pi,incoming)
   .setVisibility(Notification.VISIBILITY_PUBLIC).build()
  if(Build.VERSION.SDK_INT<33||ContextCompat.checkSelfPermission(this,Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED){
   getSystemService(NotificationManager::class.java).notify(707,notification)
  }
 }
}
