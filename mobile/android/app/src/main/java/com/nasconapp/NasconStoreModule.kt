package com.nasconapp

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Local SQLite cache + persistent offline action queue (NFR-4). */
private class KvDb(ctx: Context) : SQLiteOpenHelper(ctx, "nascon.db", null, 1) {
  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)")
  }
  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}
}

/**
 * NasconStore: SQLite key-value storage, Android-Keystore-encrypted secrets (NFR-5 secure token
 * storage) and saving receipt PDFs to Downloads. No third-party dependencies.
 */
class NasconStoreModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  private val db by lazy { KvDb(ctx).writableDatabase }
  private val prefs by lazy { ctx.getSharedPreferences("nascon_secure", Context.MODE_PRIVATE) }

  override fun getName() = "NasconStore"

  @ReactMethod
  fun getItem(key: String, promise: Promise) {
    try {
      db.rawQuery("SELECT v FROM kv WHERE k = ?", arrayOf(key)).use { c ->
        promise.resolve(if (c.moveToFirst()) c.getString(0) else null)
      }
    } catch (e: Exception) { promise.reject("E_STORE", e) }
  }

  @ReactMethod
  fun setItem(key: String, value: String, promise: Promise) {
    try {
      val cv = ContentValues().apply { put("k", key); put("v", value) }
      db.insertWithOnConflict("kv", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
      promise.resolve(true)
    } catch (e: Exception) { promise.reject("E_STORE", e) }
  }

  @ReactMethod
  fun removeItem(key: String, promise: Promise) {
    try {
      db.delete("kv", "k = ?", arrayOf(key))
      promise.resolve(true)
    } catch (e: Exception) { promise.reject("E_STORE", e) }
  }

  private fun secretKey(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .build(),
    )
    return gen.generateKey()
  }

  @ReactMethod
  fun secureSet(key: String, value: String, promise: Promise) {
    try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, secretKey())
      val ct = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
      val packed = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP)
      prefs.edit().putString(key, packed).apply()
      promise.resolve(true)
    } catch (e: Exception) { promise.reject("E_SECURE", e) }
  }

  @ReactMethod
  fun secureGet(key: String, promise: Promise) {
    try {
      val packed = prefs.getString(key, null) ?: return promise.resolve(null)
      val (iv, ct) = packed.split(":").map { Base64.decode(it, Base64.NO_WRAP) }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
      promise.resolve(String(cipher.doFinal(ct), Charsets.UTF_8))
    } catch (e: Exception) { promise.resolve(null) }
  }

  @ReactMethod
  fun secureRemove(key: String, promise: Promise) {
    prefs.edit().remove(key).apply()
    promise.resolve(true)
  }

  /** Saves a base64 PDF to the public Downloads folder (Android 10+) and returns where it went. */
  @ReactMethod
  fun savePdf(fileName: String, base64: String, promise: Promise) {
    try {
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val cv = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, fileName)
          put(MediaStore.Downloads.MIME_TYPE, "application/pdf")
          put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
        }
        val uri = ctx.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv)
          ?: return promise.reject("E_SAVE", "Could not create the file")
        ctx.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
        promise.resolve("Downloads/$fileName")
      } else {
        val f = File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), fileName)
        f.writeBytes(bytes)
        promise.resolve(f.absolutePath)
      }
    } catch (e: Exception) { promise.reject("E_SAVE", e) }
  }

  companion object { private const val ALIAS = "nascon_token_key" }
}
