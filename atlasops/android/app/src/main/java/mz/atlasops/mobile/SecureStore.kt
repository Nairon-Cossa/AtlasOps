package mz.atlasops.mobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Never stores a plaintext enrollment/device token in SharedPreferences. */
object SecureStore {
 private const val ALIAS = "atlasops-device-key-v1"
 private const val PREF = "atlasops_encrypted_v1"
 private fun key(): SecretKey {
  val store=KeyStore.getInstance("AndroidKeyStore").apply {load(null)}
  (store.getKey(ALIAS,null) as? SecretKey)?.let{return it}
  val generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore")
  generator.init(KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
   .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
   .setKeySize(256).setRandomizedEncryptionRequired(true).build())
  return generator.generateKey()
 }
 fun put(context:Context,name:String,value:String){
  val cipher=Cipher.getInstance("AES/GCM/NoPadding")
  cipher.init(Cipher.ENCRYPT_MODE,key())
  val sealed=cipher.iv+cipher.doFinal(value.toByteArray(Charsets.UTF_8))
  context.getSharedPreferences(PREF,Context.MODE_PRIVATE).edit()
   .putString(name,Base64.encodeToString(sealed,Base64.NO_WRAP)).apply()
 }
 fun get(context:Context,name:String):String? {
  val encoded=context.getSharedPreferences(PREF,Context.MODE_PRIVATE).getString(name,null)?:return null
  return try {
   val bytes=Base64.decode(encoded,Base64.NO_WRAP)
   if(bytes.size<=28)return null
   val cipher=Cipher.getInstance("AES/GCM/NoPadding")
   cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,bytes.copyOfRange(0,12)))
   String(cipher.doFinal(bytes.copyOfRange(12,bytes.size)),Charsets.UTF_8)
  }catch(_:Exception){null}
 }
}
