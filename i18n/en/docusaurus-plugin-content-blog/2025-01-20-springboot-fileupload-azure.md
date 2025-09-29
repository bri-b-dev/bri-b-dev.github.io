---
slug: springboot-fileupload-azure
title: "Streaming File Uploads to Azure Blob Storage with Spring Boot"
authors: brigitte
tags: [spring-boot, kotlin, java, azure, blob-storage, fileupload]
date: 2025-01-20
description: "Memory-efficient processing of large uploads directly in Azure Storage—without temporary storage in RAM."
---

import Admonition from '@theme/Admonition';

Anyone who wants to upload large files (several gigabytes) via a web application quickly reaches their limits:
- Classic multipart processing loads everything into memory or onto the disk.
- Uploads take a long time and block threads.
- Upload errors lead to inconsistent data states.
<!-- truncate -->
With a **streaming-based approach**, files can be written directly to Azure Blob Storage during upload – without ever being cached in RAM or on disk.

---



## ⚙️ Setup

- **Spring Boot + Kotlin** as a Basis
- [`commons-fileupload2-core`](https://commons.apache.org/proper/commons-fileupload/) for streaming multipart parsing
- **Azure Blob Storage SDK** for writing streams to blobs
- **SAS tokens** for scoped & time-limited access

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
```

👉 No file is stored on the disk or in the working memory – the InputStream is passed directly to Azure.

---

## 🔍 Extension: Determining MIME type with Tika

Often, the `Content-Type` provided by the client is not sufficient. To determine the **actual MIME type**, a **Custom InputStream** can be used, which caches the first bytes so that [Apache Tika](https://tika.apache.org/) can perform recognition:

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

⚡ Advantage: MIME detection happens **in the stream** without having to read the entire file.

---

## 📦 On-the-fly compression

For certain data types, **on-the-fly compression** is worthwhile. This involves packing the upload stream directly into a `GZIPOutputStream` before it is transferred to Azure:

```kotlin
val blobClient = containerClient.getBlobClient(“${item.name}.gz")
blobClient.getBlockBlobClient().upload(
    GZIPOutputStream(item.inputStream),
    item.size, // unknown if necessary, then use -1 and chunked upload
    true)

```

* Saves a lot of storage space and bandwidth.
* Should be **optional** (e.g., depending on the MIME type from Tika).
* Caution with binary files (videos, images): compression usually does not offer any advantages here.

---

## 🚧 Stumbling blocks

* **Multipart parsing:** Streams must be closed reliably.
* **Content length:** Not always delivered by the client → possibly use chunked upload.
* **Error handling:** If the upload is interrupted, metadata may also need to be rolled back.
* **Tika + compression:** Perform recognition first, then compress if necessary.

---

## ✅ Best practices

* **Backpressure:** Never buffer uploads, but stream them through.
* **Separation of metadata & storage**: separate services for separate responsibilities.
* **SAS tokens**: generate with prefix scopes and short lifetime.
* **Combination of Tika + compression**: Only compress if it really makes sense.

<Admonition type="note" title="Practical benefits">
We use this technique in production systems to process terabyte-scale uploads in a high-performance, secure, and cost-optimized manner.
</Admonition>

---

## 📌 Conclusion

Streaming uploads are **feasible and production-ready** in Spring Boot – and even more flexible thanks to MIME detection and optional on-the-fly compression.
The result: **lower infrastructure costs, better performance, and greater robustness**.

---

> Complete, executable example: Streaming multipart with `commons-fileupload2-core`, MIME detection via Apache Tika, optional on-the-fly compression (GZIP), and upload directly to Azure Blob Storage via SAS – **without** RAM/disk buffers.

---

## Project-Setup (Gradle Kotlin DSL)

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

    // Apache Tika for MIME-Erkennung
    implementation("org.apache.tika:tika-core:2.9.2")

    // Jackson / Kotlin
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin")
    implementation(kotlin("reflect"))

    testImplementation("org.springframework.boot:spring-boot-starter-test")
}

tasks.test { useJUnitPlatform() }
```

> **Note:** Update versions to the latest version if necessary.

**`src/main/resources/application.yaml`**

```yaml
server:
  tomcat:
    max-swallow-size: -1 # prevents termination with large streams
    max-http-form-post-size: -1

azure:
  storage:
    # Fully qualified SAS URL of the container, e.g.:
    # https://<account>.blob.core.windows.net/<container>?sv=...&sig=...
    containerSasUrl: ${AZURE_CONTAINER_SAS_URL:}

upload:
  compression:
    enabled: true # global switch, can be overridden per request
```

---

## Configuration: Azure Blob Container Client

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
    /** Full container SAS URL including token */
    lateinit var containerSasUrl: String
}
```

---

## Utility: PeekableInputStream + MIME detection (Tika)

**`src/main/kotlin/com/example/upload/io/PeekableInputStream.kt`**

```kotlin
package com.example.upload.io

import java.io.BufferedInputStream
import java.io.InputStream

/**
 * Wraps an InputStream, allows peek via mark/reset without reading the entire stream.
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

## Service: Streaming upload with optional on-the-fly GZIP compression

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
     * Stream multipart files directly to Azure. No intermediate buffers/temp files.
     * @param request Spring/Servlet request adapter for FileUpload2
     * @param forceCompression Optional override (header/param)
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

                // Make input stream peek-capable
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
        // Heuristics: textual = compress
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

        // For unknown length: write via OutputStream (no length required)
        client.getBlobOutputStream(true).use { blobOut ->
            if (compress) {
                GZIPOutputStream(blobOut).use { gz ->
                    input.copyTo(gz, DEFAULT_BUFFER)
                    // GZIPOutputStream .close() writes Footer
                }
            } else {
                input.copyTo(blobOut, DEFAULT_BUFFER)
            }
        }
    }

    companion object { const val DEFAULT_BUFFER = 1024 * 1024 }
}
```

> We use **`BlockBlobClient.getBlobOutputStream(overwrite = true)`** so that no content length is required. This keeps the upload completely streaming-based.

---

## Controller: Minimal API (pass through servlet request)

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

## Error handling & (optional) rollback example

**Pattern:** Manage metadata and blobs separately. Write the blob first, then create the metadata – or vice versa, with a **compensating action**.

```kotlin
try {
    // 1) Blob/Upload
    val result = service.handleStreamingUpload(ctx)

    // 2) Send metadata to backend
    metadataClient.createFor(result.files)

    return result
} catch (ex: Exception) {
    // Rollback strategy: delete any metadata that may have been created
    runCatching { metadataClient.rollback() }
    throw ex
}
```

---

## Test with `curl`

```bash
curl -X POST "http://localhost:8080/api/upload" \
  -H "x-compress: true" \
  -F "file=@./sample.csv" \
  -H "Expect:" # verhindert 100-continue Verzögerung
```

---

## Security & operational aspects (short checklist)

* **SAS tokens**: prefix-scoped (target path only), short lifetime, only necessary permissions (manage write/create/delete separately).
* **Backpressure**: no buffers, no temporary files; Tomcat limits (see `application.yaml`).
* **Limits**: Set server and proxy timeouts (AGIC/APIM) high enough.
* **Observability**: Log upload duration, bytes, client IP, MIME, compression flag (without PII). Traces for error paths.
* **Validation**: Whitelist of permitted MIME types, max file size on the server side (cancel early), virus scan as needed.

---

## FAQ

**How do I determine the blob content type/encoding?**
If not compressed: set `Content-Type` via blob HTTP header/metadata. For GZIP: set `Content-Encoding: gzip`, optionally save original MIME as user metadata.

**Example:**

```kotlin
val block = container.getBlobClient(blobName).blockBlobClient
val headers = com.azure.storage.blob.models.BlobHttpHeaders()
    .setContentType("application/json")
    .setContentEncoding("gzip")
block.setHttpHeaders(headers)
```

> `setHttpHeaders` can be set after the upload (separate call) – or you can use `beginUpload`/`commitBlockList` with options.

**How do I prevent RAM spikes?**
Keep buffers small (1–4 MB), `copyTo` buffer constant. No `ByteArrayOutputStream` accumulation.

**Can I parallelize?**
For pure streaming endpoints: rather no (no length). For large known files, `ParallelTransferOptions` can be useful for `upload(InputStream, length)`.

---

## End-to-end sequence (simplified steps)

1. Client sends multipart → Server parses stream via FileUpload2.
2. MIME detection via Peek (Tika).
3. Optional GZIP → Stream is compressed on-the-fly.
4. BlobOutputStream writes directly to Azure.
5. Optional: Set HTTP header/metadata, call metadata service.
6. Error → Trigger compensation (rollback).

---
