---
slug: field-filtering-rest-jackson
title: "Field-Filtering in REST-APIs mit Jackson & @ControllerAdvice"
authors: brigitte
tags: [spring-boot, kotlin, java, rest, jackson, json]
date: 2025-02-17
description: "Dynamische Reduktion von Response-Feldern über Query-Parameter – elegante Lösung mit Mixins und MappingJacksonValue."
---

import Admonition from '@theme/Admonition';

Oft wollen Clients **nicht alle Felder** einer REST-Response zurückbekommen.  
Beispiele:
- Mobile Apps brauchen nur `id` und `name`, nicht das komplette DTO.  
- Analytics-Systeme wollen nur bestimmte Metriken.  
<!--truncate-->
Statt mehrere Endpunkte zu bauen, kann man **Field-Filtering per Query-Parameter** implementieren:  
`GET /api/spaces?fields=id,name`

---

## ⚙️ Setup
Wir nutzen:
- **Spring Boot (Kotlin/Java)**  
- **Jackson @JsonFilter + Mixins**  
- **@ControllerAdvice**, das `MappingJacksonValue` zurückgibt  

---

## 🔗 Beispiel: DTOs & Controller

**`SpaceReadDTO.kt`**
```kotlin
data class SpaceReadDTO(
    val id: UUID,
    val name: String,
    val description: String,
    val createdAt: Instant,
    val owner: String
)
````

**`SpaceController.kt`**

```kotlin
@RestController
@RequestMapping("/api/spaces")
class SpaceController {

    @GetMapping
    fun getSpaces(): List<SpaceReadDTO> =
        listOf(
            SpaceReadDTO(UUID.randomUUID(), "Alpha", "First Space", Instant.now(), "Brigitte"),
            SpaceReadDTO(UUID.randomUUID(), "Beta", "Second Space", Instant.now(), "Alex")
        )
}
```

👉 Noch ohne Filterung.

---

## 🪄 Field-Filter Advice

Wir schreiben ein **@ControllerAdvice**, das Responses abfängt und bei Bedarf Felder reduziert:

**`FieldFilterAdvice.kt`**

```kotlin
@ControllerAdvice
class FieldFilterAdvice(val objectMapper: ObjectMapper) : ResponseBodyAdvice<Any> {

    override fun supports(
        returnType: MethodParameter,
        converterType: Class<out HttpMessageConverter<*>>
    ) = true

    override fun beforeBodyWrite(
        body: Any?,
        returnType: MethodParameter,
        contentType: MediaType,
        converterType: Class<out HttpMessageConverter<*>>,
        request: ServerHttpRequest,
        response: ServerHttpResponse
    ): Any? {
        if (body == null) return null

        val servletRequest = (request as? ServletServerHttpRequest)?.servletRequest
        val fieldsParam = servletRequest?.getParameter("fields") ?: return body

        val fields = fieldsParam.split(",").map { it.trim() }.toSet()
        if (fields.isEmpty()) return body

        // Dynamisches Filter-Setup
        val filterId = "dynamicFilter"
        objectMapper.setFilterProvider(
            SimpleFilterProvider().addFilter(
                filterId,
                SimpleBeanPropertyFilter.filterOutAllExcept(fields)
            )
        )

        // Mixin mit @JsonFilter
        val targetClass = body.javaClass
        objectMapper.addMixIn(targetClass, DynamicFilterMixin::class.java)

        return MappingJacksonValue(body).apply { filters = objectMapper.serializationConfig.filterProvider }
    }

    @JsonFilter("dynamicFilter")
    class DynamicFilterMixin
}
```

---

## 🚀 Ergebnis

Aufruf ohne Parameter:

```http
GET /api/spaces
```

Response:

```json
[
  { "id": "…", "name": "Alpha", "description": "First Space", "createdAt": "…", "owner": "Brigitte" }
]
```

Aufruf mit Filter:

```http
GET /api/spaces?fields=id,name
```

Response:

```json
[
  { "id": "…", "name": "Alpha" }
]
```

---

## ✅ Lessons Learned

* Funktioniert für einzelne Objekte **und** Listen.
* `fields`-Parameter ist flexibel kombinierbar (`id,name,owner`).
* Mehrere DTOs → bei Bedarf eigene Filter-IDs und Mixins.
* Vorsicht bei **Nested Objects** – Field-Filtering wirkt nur auf oberster Ebene.

<Admonition type="tip" title="Pro Tipp">
Baue dir Helper-Methoden für häufig genutzte Feldsets, z. B. `?fields=summary` → wird in konkrete Felder expandiert.
</Admonition>

---

## 📌 Fazit

Mit `@ControllerAdvice`, Jackson-Filter und `MappingJacksonValue` lässt sich **Field-Filtering elegant & generisch** umsetzen.
Damit sparst du Boilerplate-Endpoints und gibst Clients genau die Daten zurück, die sie wirklich brauchen.
