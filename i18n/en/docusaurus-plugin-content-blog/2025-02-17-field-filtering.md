---
slug: field-filtering-rest-jackson
title: "Field-Filtering in REST-APIs with Jackson & @ControllerAdvice"
authors: brigitte
tags: [spring-boot, kotlin, java, rest, jackson, json]
date: 2025-02-17
description: "Dynamic reduction of response fields via query parameters – an elegant solution with mixins and MappingJacksonValue."
---

import Admonition from '@theme/Admonition';

Clients often do not want to receive **all fields** of a REST response.  
Examples:
- Mobile apps only need `id` and `name`, not the complete DTO.  
- Analytics systems only want certain metrics.  
<!--truncate-->
Instead of building multiple endpoints, you can implement **field filtering via query parameters**:  
`GET /api/spaces?fields=id,name`

---

## ⚙️ Setup

We use:
- **Spring Boot (Kotlin/Java)**  
- **Jackson @JsonFilter + Mixins**  
- **@ControllerAdvice**, `MappingJacksonValue` returns  

---

## 🔗 Example: DTOs & Controller

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

👉 Still without filtering.

---

## 🪄 Field-Filter Advice

We write a **@ControllerAdvice** that intercepts responses and reduces fields if necessary:

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

        // Dynamic Filter-Setup
        val filterId = "dynamicFilter"
        objectMapper.setFilterProvider(
            SimpleFilterProvider().addFilter(
                filterId,
                SimpleBeanPropertyFilter.filterOutAllExcept(fields)
            )
        )

        // Mixin with @JsonFilter
        val targetClass = body.javaClass
        objectMapper.addMixIn(targetClass, DynamicFilterMixin::class.java)

        return MappingJacksonValue(body).apply { filters = objectMapper.serializationConfig.filterProvider }
    }

    @JsonFilter("dynamicFilter")
    class DynamicFilterMixin
}
```

---

## 🚀 Result

Call without parameter:

```http
GET /api/spaces
```

Response:

```json
[
  { "id": "…", "name": "Alpha", "description": "First Space", "createdAt": "…", "owner": "Brigitte" }
]
```

Call with filter:

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

* Works for individual objects **and** lists.
* `fields` parameter can be combined flexibly (`id,name,owner`).
* Multiple DTOs → use your own filter IDs and mixins if necessary.
* Be careful with **nested objects** – field filtering only works at the top level.

<Admonition type="tip" title="Pro tip">
Build helper methods for frequently used field sets, e.g., `?fields=summary` → expands into specific fields.
</Admonition>

---

## 📌 Conclusion

With `@ControllerAdvice`, Jackson filters, and `MappingJacksonValue`, **field filtering can be implemented elegantly and generically**.
This saves you boilerplate endpoints and returns exactly the data that clients really need.
