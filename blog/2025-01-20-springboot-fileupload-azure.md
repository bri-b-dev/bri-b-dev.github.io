---
slug: springboot-fileupload-azure
title: "Streaming File Uploads nach Azure Blob Storage mit Spring Boot"
authors: brigitte
tags: [spring-boot, kotlin, java, azure, blob-storage, fileupload]
date: 2025-01-20
description: "Speicherschonende Verarbeitung großer Uploads direkt in Azure Storage – ohne Zwischenspeicherung im RAM."
---

import Admonition from '@theme/Admonition';

Wer große Dateien (mehrere Gigabyte) über eine Webanwendung hochladen möchte, stößt schnell an Grenzen:  
- Klassische Multipart-Verarbeitung lädt alles in den Speicher oder auf die Platte.  
- Uploads dauern lange und blockieren Threads.  
- Fehler beim Upload führen zu inkonsistenten Datenständen.  
<!-- truncate -->

Mit einem **streamingbasierten Ansatz** können Dateien direkt beim Upload in Azure Blob Storage geschrieben werden – ohne dass sie jemals im RAM oder auf der Platte zwischengespeichert werden.

---

## ⚙️ Setup

- **Spring Boot + Kotlin** als Basis  
- [`commons-fileupload2-core`](https://commons.apache.org/proper/commons-fileupload/) für das Streaming-Multipart-Parsing  
- **Azure Blob Storage SDK** für das Schreiben von Streams in Blobs  
- **SAS-Tokens** für scoped & zeitlich begrenzten Zugriff  

### Streaming Multipart Upload

```kotlin
val iterator = FileUploadStreaming.getItemIterator(request)
while (iterator.hasNext()) {
    val item = iterator.next()
    if (!item.isFormField) {
        val blobClient = containerClient.getBlobClient(item.name)
        blobClient.getBlockBlobClient().upload(item.inputStream, item.size, true)
    }
}
````

👉 Keine Datei landet auf der Platte oder im Arbeitsspeicher – der InputStream wird direkt nach Azure durchgereicht.

---

## 🔍 Erweiterung: MIME-Type mit Tika ermitteln

Oft reicht der vom Client mitgelieferte `Content-Type` nicht. Um den **tatsächlichen MIME-Type** zu bestimmen, kann ein **Custom InputStream** genutzt werden, der die ersten Bytes cached, damit [Apache Tika](https://tika.apache.org/) eine Erkennung vornehmen kann:

```kotlin
class TikaInputStream(private val source: InputStream) : InputStream() {
    private val buffer = ByteArrayOutputStream()
    private var replay: ByteArrayInputStream? = null
    private var probed = false

    override fun read(): Int {
        val replayStream = replay
        return if (replayStream != null) {
            replayStream.read()
        } else {
            val b = source.read()
            if (!probed && b != -1) buffer.write(b)
            b
        }
    }

    fun detectMimeType(): String {
        if (!probed) {
            probed = true
            val bytes = buffer.toByteArray()
            replay = ByteArrayInputStream(bytes)
            return Tika().detect(bytes)
        }
        return "application/octet-stream"
    }
}
```

⚡ Vorteil: MIME-Erkennung passiert **im Stream**, ohne dass die Datei vollständig eingelesen werden muss.

---

## 📦 On-the-Fly-Kompression

Für bestimmte Datentypen lohnt sich **On-the-fly-Kompression**. Dabei wird der Upload-Stream direkt in einen `GZIPOutputStream` verpackt, bevor er nach Azure wandert:

```kotlin
val blobClient = containerClient.getBlobClient("${item.name}.gz")
blobClient.getBlockBlobClient().upload(
    GZIPOutputStream(item.inputStream),
    item.size, // ggf. unbekannt, dann -1 und chunked upload verwenden
    true
)
```

* Spart massiv Speicherplatz und Bandbreite.
* Sollte **optional** sein (z. B. abhängig vom MIME-Type aus Tika).
* Achtung bei Binärdateien (Videos, Bilder): hier bringt Kompression meist keinen Vorteil.

---

## 🚧 Stolpersteine

* **Multipart-Parsing:** Streams müssen zuverlässig geschlossen werden.
* **Content-Length:** Nicht immer vom Client geliefert → evtl. chunked Upload nutzen.
* **Fehlerhandling:** Bei Upload-Abbruch müssen ggf. auch Metadaten zurückgerollt werden.
* **Tika + Kompression:** Erkennung zuerst durchführen, danach ggf. komprimieren.

---

## ✅ Best Practices

* **Backpressure**: Uploads niemals puffern, sondern durchstreamen.
* **Trennung von Metadaten & Storage**: eigene Services für Verantwortlichkeiten.
* **SAS-Tokens**: mit Prefix-Scopes und kurzer Laufzeit generieren.
* **Kombination Tika + Kompression**: Nur komprimieren, wenn es wirklich Sinn ergibt.

<Admonition type="note" title="Praxisnutzen">
Diese Technik nutzen wir in Produktionssystemen, um Uploads im Terabyte-Bereich performant, sicher und kostenoptimiert zu verarbeiten.
</Admonition>

---

## 📌 Fazit

Streaming Uploads sind in Spring Boot **machbar und produktionsreif** – und durch MIME-Erkennung sowie optionale On-the-fly-Kompression sogar noch flexibler.
Das Resultat: **weniger Infrastrukturkosten, bessere Performance und höhere Robustheit**.

---

> Komplettes, lauffähiges Beispiel: Streaming-Multipart mit `commons-fileupload2-core`, MIME-Erkennung via Apache Tika, optionale On‑the‑fly‑Kompression (GZIP) und Upload direkt in Azure Blob Storage über SAS – **ohne** RAM-/Disk-Puffer.

---

## Projekt-Setup (Gradle Kotlin DSL)

**`build.gradle.kts`**

```kotlin
plugins {
    id("org.springframework.boot") version "3.3.0"
    id("io.spring.dependency-management") version "1.1.5"
    kotlin("jvm") version "1.9.24"
    kotlin("plugin.spring") version "1.9.24"
}

group = "com.example"
version = "0.0.1"
java.sourceCompatibility = JavaVersion.VERSION_17

repositories { mavenCentral() }

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")

    // Azure Blob Storage SDK v12
    implementation("com.azure:azure-storage-blob:12.26.0")

    // Streaming Multipart Parsing
    implementation("org.apache.commons:commons-fileupload2-core:2.0.0-M1")

    // Apache Tika für MIME-Erkennung
    implementation("org.apache.tika:tika-core:2.9.2")

    // Jackson / Kotlin
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin")
    implementation(kotlin("reflect"))

    testImplementation("org.springframework.boot:spring-boot-starter-test")
}

tasks.test { useJUnitPlatform() }
```

> **Hinweis:** Versionen ggf. auf den aktuellen Stand bringen.

**`src/main/resources/application.yaml`**

```yaml
server:
  tomcat:
    max-swallow-size: -1 # verhindert Abbruch bei großen Streams
    max-http-form-post-size: -1

azure:
  storage:
    # Vollqualifizierte SAS-URL des Containers, z. B.:
    # https://<account>.blob.core.windows.net/<container>?sv=...&sig=...
    containerSasUrl: ${AZURE_CONTAINER_SAS_URL:}

upload:
  compression:
    enabled: true # globaler Schalter, kann pro Request überschrieben werden
```

---

## Konfiguration: Azure Blob Container Client

**`src/main/kotlin/com/example/upload/AzureStorageConfig.kt`**

```kotlin
package com.example.upload

import com.azure.storage.blob.BlobContainerClient
import com.azure.storage.blob.BlobContainerClientBuilder
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration
class AzureStorageConfig {
    @Bean
    @ConfigurationProperties(prefix = "azure.storage")
    fun azureStorageProps() = AzureStorageProps()

    @Bean
    fun blobContainerClient(props: AzureStorageProps): BlobContainerClient =
        BlobContainerClientBuilder()
            .endpoint(props.containerSasUrl)
            .buildClient()
}

class AzureStorageProps {
    /** Vollständige Container-SAS-URL inkl. Token */
    lateinit var containerSasUrl: String
}
```

---

## Utility: PeekableInputStream + MIME-Erkennung (Tika)

**`src/main/kotlin/com/example/upload/io/PeekableInputStream.kt`**

```kotlin
package com.example.upload.io

import java.io.BufferedInputStream
import java.io.InputStream

/**
 * Wrappt einen InputStream, erlaubt Peek via mark/reset ohne volles Einlesen.
 */
class PeekableInputStream(source: InputStream, private val peekBufferSize: Int = 8192) : InputStream() {
    private val inBuf = if (source.markSupported()) source else BufferedInputStream(source, peekBufferSize)

    override fun read(): Int = inBuf.read()
    override fun read(b: ByteArray, off: Int, len: Int): Int = inBuf.read(b, off, len)
    override fun close() = inBuf.close()

    fun <T> peek(peekLen: Int = peekBufferSize, block: (ByteArray) -> T): T {
        inBuf.mark(peekLen)
        val buf = ByteArray(peekLen)
        val n = inBuf.read(buf)
        inBuf.reset()
        val slice = if (n <= 0) ByteArray(0) else buf.copyOf(n)
        return block(slice)
    }
}
```

**`src/main/kotlin/com/example/upload/mime/MimeDetector.kt`**

```kotlin
package com.example.upload.mime

import com.example.upload.io.PeekableInputStream
import org.apache.tika.Tika

object MimeDetector {
    private val tika = Tika()

    fun detect(peekable: PeekableInputStream, fallback: String = "application/octet-stream"): String =
        peekable.peek { bytes ->
            val detected = runCatching { tika.detect(bytes) }.getOrNull()
            detected ?: fallback
        }
}
```

---

## Service: Streaming Upload mit optionaler On‑the‑fly‑GZIP

**`src/main/kotlin/com/example/upload/UploadService.kt`**

```kotlin
package com.example.upload

import com.azure.storage.blob.BlobContainerClient
import com.azure.storage.blob.specialized.BlockBlobClient
import com.example.upload.io.PeekableInputStream
import com.example.upload.mime.MimeDetector
import org.apache.commons.fileupload2.core.FileItemInputIterator
import org.apache.commons.fileupload2.core.FileUpload
import org.apache.commons.fileupload2.core.FileUploadException
import org.apache.commons.fileupload2.core.RequestContext
import org.springframework.stereotype.Service
import java.io.InputStream
import java.util.zip.GZIPOutputStream

@Service
class UploadService(private val container: BlobContainerClient) {

    data class UploadResult(val files: List<FileInfo>)
    data class FileInfo(
        val fieldName: String,
        val filename: String,
        val size: Long?,
        val mimeType: String,
        val compressed: Boolean,
        val blobName: String
    )

    /**
     * Streamt Multipart-Dateien direkt nach Azure. Keine Zwischenpuffer/Tempfiles.
     * @param request Spring/Servlet Request-Adapter für FileUpload2
     * @param forceCompression optionaler Override (Header/Param)
     */
    fun handleStreamingUpload(request: RequestContext, forceCompression: Boolean? = null): UploadResult {
        try {
            val iter: FileItemInputIterator = FileUpload().getItemIterator(request)
            val uploaded = mutableListOf<FileInfo>()

            while (iter.hasNext()) {
                val item = iter.next()
                if (item.isFormField) continue

                val originalName = item.name ?: "upload.bin"
                val field = item.fieldName ?: "file"
                val size = item.headers?.getHeader("Content-Length")?.toLongOrNull()

                // Eingangsstream peek-fähig machen
                val peekable = PeekableInputStream(item.inputStream)
                val mime = MimeDetector.detect(peekable)

                val shouldCompress = forceCompression
                    ?: shouldCompressMime(mime)

                val (blobName, compressed) = if (shouldCompress) {
                    val nameGz = "$originalName.gz"
                    uploadStream(peekable, nameGz, compress = true)
                    nameGz to true
                } else {
                    uploadStream(peekable, originalName, compress = false)
                    originalName to false
                }

                uploaded += FileInfo(
                    fieldName = field,
                    filename = originalName,
                    size = size,
                    mimeType = mime,
                    compressed = compressed,
                    blobName = blobName
                )
            }

            return UploadResult(uploaded)
        } catch (e: FileUploadException) {
            throw RuntimeException("Multipart parsing failed", e)
        }
    }

    private fun shouldCompressMime(mime: String): Boolean {
        // Heuristik: textuell = komprimieren
        if (mime.startsWith("text/")) return true
        return mime in setOf(
            "application/json",
            "application/xml",
            "application/x-ndjson",
            "text/csv",
            "application/csv"
        )
    }

    private fun uploadStream(input: InputStream, blobName: String, compress: Boolean) {
        val client: BlockBlobClient = container.getBlobClient(blobName).blockBlobClient

        // Für unbekannte Länge: über OutputStream schreiben (kein length nötig)
        client.getBlobOutputStream(true).use { blobOut ->
            if (compress) {
                GZIPOutputStream(blobOut).use { gz ->
                    input.copyTo(gz, DEFAULT_BUFFER)
                    // GZIPOutputStream .close() schreibt den Footer
                }
            } else {
                input.copyTo(blobOut, DEFAULT_BUFFER)
            }
        }
    }

    companion object { const val DEFAULT_BUFFER = 1024 * 1024 }
}
```

> Wir nutzen **`BlockBlobClient.getBlobOutputStream(overwrite = true)`**, damit keine Content-Length benötigt wird. So bleibt der Upload vollständig streamingbasiert.

---

## Controller: Minimal-API (Servlet Request durchreichen)

**`src/main/kotlin/com/example/upload/UploadController.kt`**

```kotlin
package com.example.upload

import org.apache.commons.fileupload2.core.RequestContext
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import jakarta.servlet.http.HttpServletRequest

@RestController
@RequestMapping("/api")
class UploadController(private val service: UploadService) {

    @PostMapping("/upload", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun upload(
        request: HttpServletRequest,
        @RequestHeader(name = "x-compress", required = false) compressHeader: String?
    ): UploadService.UploadResult {
        val forceCompression: Boolean? = compressHeader?.let { it.equals("true", ignoreCase = true) }

        val ctx = object : RequestContext {
            override fun getContentType(): String = request.contentType
            override fun getContentLength(): Int = request.contentLength
            override fun getCharacterEncoding(): String? = request.characterEncoding
            override fun getInputStream() = request.inputStream
        }

        return service.handleStreamingUpload(ctx, forceCompression)
    }
}
```

---

## Fehlerbehandlung & (optionaler) Rollback-Beispiel

**Pattern:** Metadaten und Blob getrennt verwalten. Erst Blob schreiben, dann Metadaten anlegen – oder umgekehrt, mit **Kompensationsaktion**.

```kotlin
try {
    // 1) Blob/Upload
    val result = service.handleStreamingUpload(ctx)

    // 2) Metadaten an Backend senden
    metadataClient.createFor(result.files)

    return result
} catch (ex: Exception) {
    // Rollback-Strategie: evtl. angelegte Metadaten löschen
    runCatching { metadataClient.rollback() }
    throw ex
}
```

---

## Test mit `curl`

```bash
curl -X POST "http://localhost:8080/api/upload" \
  -H "x-compress: true" \
  -F "file=@./sample.csv" \
  -H "Expect:" # verhindert 100-continue Verzögerung
```

---

## Sicherheits- & Betriebsaspekte (Kurzchecklist)

* **SAS-Token**: prefix-scoped (nur Zielpfad), kurze Laufzeit, nur benötigte Rechte (Write/Create/Delete separat managen).
* **Backpressure**: keine Puffer, keine Temporary Files; Tomcat-Limits (siehe `application.yaml`).
* **Limits**: Server- und Proxy-Timeouts (AGIC/APIM) hoch genug einstellen.
* **Observability**: Upload-Dauer, Bytes, Client-IP, MIME, Kompressionsflag loggen (ohne PII). Traces für Fehlerpfade.
* **Validation**: Whitelist erlaubter MIME-Types, Max-File-Size serverseitig (frühzeitig abbrechen), Virenscan je nach Bedarf.

---

## FAQ

**Wie bestimme ich die Blob Content-Type/Encoding?**
Wenn nicht komprimiert: setze `Content-Type` über Blob-HTTP-Header/Metadata. Bei GZIP: `Content-Encoding: gzip` setzen, optional Original-MIME als Benutzer-Metadatum speichern.

**Beispiel:**

```kotlin
val block = container.getBlobClient(blobName).blockBlobClient
val headers = com.azure.storage.blob.models.BlobHttpHeaders()
    .setContentType("application/json")
    .setContentEncoding("gzip")
block.setHttpHeaders(headers)
```

> `setHttpHeaders` kann nach dem Upload gesetzt werden (separater Call) – oder man nutzt `beginUpload`/`commitBlockList` mit Optionen.

**Wie verhindere ich RAM-Spikes?**
Buffers klein halten (1–4 MB), `copyTo`-Buffer konstant. Keine `ByteArrayOutputStream`-Akkumulation.

**Kann ich parallelisieren?**
Für reine Streaming-Endpunkte: eher nein (keine Länge). Für große bekannte Dateien kann `ParallelTransferOptions` beim `upload(InputStream, length)` sinnvoll sein.

---

## End-to-End Sequenz (vereinfachte Schritte)

1. Client sendet Multipart → Server parsed Stream per FileUpload2.
2. MIME-Erkennung via Peek (Tika).
3. Optional GZIP → Stream wird on-the-fly komprimiert.
4. BlobOutputStream schreibt direkt nach Azure.
5. Optional: HTTP-Header/Metadata setzen, Metadaten-Service aufrufen.
6. Fehler → Kompensation (Rollback) auslösen.

---
