<script setup>
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import confetti from 'canvas-confetti'

const title = ref('RalphAI')

function celebrate() {
  confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } })
}
</script>

<template>
  <main>
    <h1 style="cursor: pointer" @click="celebrate">{{ title }}</h1>
    <p>Welcome to the Vue 3 app.</p>
    <nav>
      <RouterLink to="/hello-agent">Say hello to the agent</RouterLink>
    </nav>
  </main>
</template>
