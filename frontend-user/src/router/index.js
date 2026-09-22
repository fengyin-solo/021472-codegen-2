import { createRouter, createWebHistory } from 'vue-router'
import { logger } from '../utils/api'
import Home from '../views/Home.vue'
import Tables from '../views/Tables.vue'
import Courses from '../views/Courses.vue'
import Competitions from '../views/Competitions.vue'
import Shop from '../views/Shop.vue'
import Profile from '../views/Profile.vue'
import Tasks from '../views/Tasks.vue'
import Training from '../views/Training.vue'

const routes = [
  { path: '/', name: 'Home', component: Home },
  { path: '/tables', name: 'Tables', component: Tables },
  { path: '/courses', name: 'Courses', component: Courses },
  { path: '/competitions', name: 'Competitions', component: Competitions },
  { path: '/shop', name: 'Shop', component: Shop },
  { path: '/profile', name: 'Profile', component: Profile },
  { path: '/tasks', name: 'Tasks', component: Tasks },
  { path: '/training', name: 'Training', component: Training }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  logger.info('Navigation', { from: from.path, to: to.path })
  next()
})

export default router
