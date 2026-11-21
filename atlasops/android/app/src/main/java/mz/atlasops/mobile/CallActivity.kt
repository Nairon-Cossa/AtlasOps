package mz.atlasops.mobile

import android.app.Activity
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.telecom.Call
import android.telecom.InCallService
import android.telecom.CallAudioState
import android.telecom.VideoProfile
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView

/** In-call UI for basic audio calls. Device/OEM certification is required before real employee rollout. */
class CallActivity:Activity(){
 private val update:()->Unit={runOnUiThread{render()}}
 private var muted=false
 private var speaker=false
 override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);setShowWhenLocked(true);setTurnScreenOn(true);setContentView(R.layout.activity_call)
  findViewById<Button>(R.id.answerButton).setOnClickListener{CallCoordinator.active?.answer(VideoProfile.STATE_AUDIO_ONLY)}
  findViewById<Button>(R.id.rejectButton).setOnClickListener{CallCoordinator.active?.reject(false,null)}
  findViewById<Button>(R.id.hangupButton).setOnClickListener{CallCoordinator.active?.disconnect()}
  findViewById<Button>(R.id.muteButton).setOnClickListener{muted=!muted;CallCoordinator.service?.setMuted(muted);render()}
  findViewById<Button>(R.id.speakerButton).setOnClickListener{speaker=!speaker;CallCoordinator.service?.setAudioRoute(if(speaker)CallAudioState.ROUTE_SPEAKER else CallAudioState.ROUTE_EARPIECE);render()}
  findViewById<Button>(R.id.dtmfButton).setOnClickListener {
   val value=findViewById<EditText>(R.id.dtmfDigit).text.toString()
   val char=value.lastOrNull{it in "0123456789*#"}?:return@setOnClickListener
   CallCoordinator.active?.playDtmfTone(char)
   Handler(Looper.getMainLooper()).postDelayed({CallCoordinator.active?.stopDtmfTone()},180)
  }
 }
 override fun onResume(){super.onResume();CallCoordinator.subscribe(update)}
 override fun onPause(){CallCoordinator.unsubscribe(update);super.onPause()}
 private fun render(){
  val call=CallCoordinator.active
  val state=when(call?.state){Call.STATE_RINGING->"Incoming call";Call.STATE_ACTIVE->"Call connected";Call.STATE_DIALING->"Dialing...";Call.STATE_CONNECTING->"Connecting...";Call.STATE_HOLDING->"On hold";Call.STATE_DISCONNECTED,null->"Call finished";else->"Company call"}
  findViewById<TextView>(R.id.callState).text=state
  findViewById<TextView>(R.id.callNumber).text=call?.details?.handle?.schemeSpecificPart?:"Unknown number"
  findViewById<Button>(R.id.answerButton).visibility=if(call?.state==Call.STATE_RINGING)View.VISIBLE else View.GONE
  findViewById<Button>(R.id.rejectButton).visibility=if(call?.state==Call.STATE_RINGING)View.VISIBLE else View.GONE
  findViewById<Button>(R.id.hangupButton).isEnabled=call!=null
  findViewById<Button>(R.id.muteButton).text=if(muted)"Unmute" else "Mute"
  findViewById<Button>(R.id.speakerButton).text=if(speaker)"Use earpiece" else "Use speaker"
 }
}
