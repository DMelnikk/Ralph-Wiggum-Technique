import { createRouter, createWebHistory } from 'vue-router'
import Home from './views/Home.vue'
import HelloAgent from './views/HelloAgent.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/hello-agent', component: HelloAgent },
  ],
})
