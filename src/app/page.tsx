import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Play, Users, MessageCircle, Video, Shield, Zap, Globe, Star, ArrowRight } from "lucide-react"
import Link from "next/link"

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 overflow-hidden">
      {/* Header */}
      <header className="container mx-auto px-4 py-6 relative z-10">
        <nav className="flex items-center justify-between animate-fadeInDown">
          <div className="flex items-center space-x-2 group cursor-pointer">
            <Play className="h-8 w-8 text-purple-400 transition-all duration-300 group-hover:scale-110 group-hover:rotate-12" />
            <span className="text-2xl font-bold text-white transition-all duration-300 group-hover:text-purple-300">
              CinemaSync
            </span>
          </div>
          <div className="flex items-center space-x-4">
            <Link href="/auth">
              <Button
                variant="outline"
                className="text-white border-white hover:bg-white hover:text-purple-900 bg-transparent transition-all duration-300 hover:scale-105 hover-glow"
              >
                Sign In
              </Button>
            </Link>
            <Link href="/auth">
              <Button className="bg-purple-600 hover:bg-purple-700 transition-all duration-300 hover:scale-105 animate-glow">
                Get Started
              </Button>
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 text-center relative z-10">
        <div className="max-w-4xl mx-auto">
          <div className="animate-fadeInUp">
            <h1 className="text-5xl md:text-7xl font-bold text-white mb-6">
              Watch Movies
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 animate-pulse">
                {" "}
                Together
              </span>
            </h1>
          </div>

          <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto animate-fadeInUp delay-200">
            Create virtual cinema rooms, invite friends, and enjoy movies together with real-time chat and video.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fadeInUp delay-400">
            <Link href="/auth">
              <Button
                size="lg"
                className="bg-purple-600 hover:bg-purple-700 text-lg px-8 py-3 transition-all duration-300 hover:scale-105 hover-lift group"
              >
                <Play className="mr-2 h-5 w-5 transition-transform duration-300 group-hover:scale-110" />
                Start Watching
                <ArrowRight className="ml-2 h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
              </Button>
            </Link>
            <Button
              size="lg"
              variant="outline"
              className="text-white border-white hover:bg-white hover:text-purple-900 text-lg px-8 py-3 bg-transparent transition-all duration-300 hover:scale-105 hover-lift"
            >
              Learn More
            </Button>
          </div>

          {/* Stats Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16 animate-fadeInUp delay-600">
            <div className="text-center group">
              <div className="text-3xl font-bold text-purple-400 mb-2 transition-all duration-300 group-hover:scale-110">
                10K+
              </div>
              <div className="text-gray-300">Active Users</div>
            </div>
            <div className="text-center group">
              <div className="text-3xl font-bold text-blue-400 mb-2 transition-all duration-300 group-hover:scale-110">
                500+
              </div>
              <div className="text-gray-300">Movie Rooms</div>
            </div>
            <div className="text-center group">
              <div className="text-3xl font-bold text-green-400 mb-2 transition-all duration-300 group-hover:scale-110">
                24/7
              </div>
              <div className="text-gray-300">Support</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-20 relative z-10">
        <div className="text-center mb-16 animate-fadeInUp">
          <h2 className="text-4xl font-bold text-white mb-4">Why Choose CinemaSync?</h2>
          <p className="text-gray-300 text-lg max-w-2xl mx-auto">
            Experience movies like never before with our social viewing platform
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {[
            {
              icon: Users,
              title: "Social Viewing",
              description: "Create rooms and watch movies with friends in real-time",
              color: "text-purple-400",
              delay: "delay-100",
            },
            {
              icon: MessageCircle,
              title: "Real-time Chat",
              description: "Chat with everyone or have private conversations during movies",
              color: "text-blue-400",
              delay: "delay-200",
            },
            {
              icon: Video,
              title: "Video & Voice Chat",
              description: "Connect face-to-face with video chat for immersive experience",
              color: "text-green-400",
              delay: "delay-300",
            },
            {
              icon: Shield,
              title: "Privacy Controls",
              description: "Full control over room privacy with public and private options",
              color: "text-yellow-400",
              delay: "delay-400",
            },
            {
              icon: Zap,
              title: "Synchronized Playback",
              description: "Perfect sync ensures everyone watches at the same time",
              color: "text-red-400",
              delay: "delay-500",
            },
            {
              icon: Globe,
              title: "Global Access",
              description: "Connect with movie lovers worldwide",
              color: "text-indigo-400",
              delay: "delay-600",
            },
          ].map((feature, index) => (
            <Card
              key={index}
              className={`bg-white/10 backdrop-blur-sm border-white/20 text-white transition-all duration-500 hover:scale-105 hover:bg-white/15 hover-lift animate-fadeInUp ${feature.delay} group cursor-pointer`}
            >
              <CardHeader>
                <feature.icon
                  className={`h-12 w-12 ${feature.color} mb-4 transition-all duration-300 group-hover:scale-110 group-hover:rotate-6`}
                />
                <CardTitle className="transition-colors duration-300 group-hover:text-purple-300">
                  {feature.title}
                </CardTitle>
                <CardDescription className="text-gray-300 group-hover:text-gray-200 transition-colors duration-300">
                  {feature.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* How It Works Section */}
      <section className="container mx-auto px-4 py-20 relative z-10">
        <div className="text-center mb-16 animate-fadeInUp">
          <h2 className="text-4xl font-bold text-white mb-4">How It Works</h2>
          <p className="text-gray-300 text-lg">Get started in just three simple steps</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              step: "1",
              title: "Create or Join Room",
              description: "Set up your cinema room with movie details and privacy settings",
              color: "bg-purple-600",
              delay: "delay-100",
            },
            {
              step: "2",
              title: "Invite Friends",
              description: "Share your room code with friends or make it public",
              color: "bg-blue-600",
              delay: "delay-300",
            },
            {
              step: "3",
              title: "Watch Together",
              description: "Enjoy synchronized movie playback with real-time chat",
              color: "bg-green-600",
              delay: "delay-500",
            },
          ].map((step, index) => (
            <div key={index} className={`text-center animate-slideInLeft ${step.delay} group`}>
              <div
                className={`${step.color} rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4 transition-all duration-300 group-hover:scale-110 hover-glow`}
              >
                <span className="text-2xl font-bold text-white">{step.step}</span>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2 transition-colors duration-300 group-hover:text-purple-300">
                {step.title}
              </h3>
              <p className="text-gray-300 group-hover:text-gray-200 transition-colors duration-300">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="container mx-auto px-4 py-20 relative z-10">
        <div className="text-center mb-16 animate-fadeInUp">
          <h2 className="text-4xl font-bold text-white mb-4">What Users Say</h2>
          <p className="text-gray-300 text-lg">Join thousands of happy movie watchers</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              name: "Sarah Johnson",
              role: "Movie Enthusiast",
              content: "CinemaSync has revolutionized how I watch movies with friends. The sync is perfect!",
              rating: 5,
              delay: "delay-100",
            },
            {
              name: "Mike Chen",
              role: "Film Student",
              content: "The video chat feature makes it feel like we're all in the same room. Amazing experience!",
              rating: 5,
              delay: "delay-300",
            },
            {
              name: "Emma Davis",
              role: "Content Creator",
              content: "Perfect for hosting movie nights with my community. Easy to use and reliable.",
              rating: 5,
              delay: "delay-500",
            },
          ].map((testimonial, index) => (
            <Card
              key={index}
              className={`bg-white/10 backdrop-blur-sm border-white/20 text-white hover-lift animate-fadeInUp ${testimonial.delay}`}
            >
              <CardHeader>
                <div className="flex items-center space-x-1 mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star key={i} className="h-4 w-4 text-yellow-400 fill-current" />
                  ))}
                </div>
                <CardDescription className="text-gray-300 mb-4">"{testimonial.content}"</CardDescription>
                <div>
                  <CardTitle className="text-sm">{testimonial.name}</CardTitle>
                  <p className="text-xs text-gray-400">{testimonial.role}</p>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20 relative z-10">
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl p-12 text-center hover-lift animate-scaleIn">
          <h2 className="text-4xl font-bold text-white mb-4">Ready to Start Watching?</h2>
          <p className="text-xl text-gray-200 mb-8">Join thousands of movie lovers already using CinemaSync</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/auth">
              <Button
                size="lg"
                className="bg-white text-purple-600 hover:bg-gray-100 text-lg px-8 py-3 transition-all duration-300 hover:scale-105 hover-lift group"
              >
                Create Your First Room
                <ArrowRight className="ml-2 h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
              </Button>
            </Link>
            <Button
              size="lg"
              variant="outline"
              className="text-white border-white hover:bg-white hover:text-purple-600 text-lg px-8 py-3 bg-transparent transition-all duration-300 hover:scale-105 hover-lift"
            >
              Browse Public Rooms
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-12 border-t border-white/20 relative z-10">
        <div className="flex flex-col md:flex-row justify-between items-center animate-fadeInUp">
          <div className="flex items-center space-x-2 mb-4 md:mb-0 group">
            <Play className="h-6 w-6 text-purple-400 transition-all duration-300 group-hover:scale-110" />
            <span className="text-xl font-bold text-white transition-colors duration-300 group-hover:text-purple-300">
              CinemaSync
            </span>
          </div>
          <div className="flex space-x-6 text-gray-300">
            {["Privacy", "Terms", "Support", "Contact"].map((link, index) => (
              <a
                key={link}
                href="#"
                className="hover:text-white transition-all duration-300 hover:scale-105 hover:text-purple-300"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                {link}
              </a>
            ))}
          </div>
        </div>
        <div className="text-center text-gray-400 mt-8 animate-fadeInUp delay-200">
          <p>&copy; 2024 CinemaSync. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
