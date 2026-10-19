import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";

import { Loading } from "./components/ui";

// Public website
const PublicLayout = lazy(() => import("./pages/public/PublicLayout"));
const Home = lazy(() => import("./pages/public/Home"));
const About = lazy(() => import("./pages/public/About"));
const Programs = lazy(() => import("./pages/public/Programs"));
const ProgramDetail = lazy(() => import("./pages/public/ProgramDetail"));
const Batches = lazy(() => import("./pages/public/Batches"));
const BatchDetail = lazy(() => import("./pages/public/BatchDetail"));
const Coaches = lazy(() => import("./pages/public/Coaches"));
const Venues = lazy(() => import("./pages/public/Venues"));
const News = lazy(() => import("./pages/public/News"));
const NewsDetail = lazy(() => import("./pages/public/NewsDetail"));
const Gallery = lazy(() => import("./pages/public/Gallery"));
const AlbumDetail = lazy(() => import("./pages/public/AlbumDetail"));
const Events = lazy(() => import("./pages/public/Events"));
const EventDetail = lazy(() => import("./pages/public/EventDetail"));
const Faq = lazy(() => import("./pages/public/Faq"));
const Contact = lazy(() => import("./pages/public/Contact"));
const Login = lazy(() => import("./pages/public/Login"));
const Register = lazy(() => import("./pages/public/Register"));
const NotFound = lazy(() => import("./pages/public/NotFound"));
const AccountRedirect = lazy(() => import("./pages/AccountRedirect"));

// Student portal
const StudentLayout = lazy(() => import("./pages/student/StudentLayout"));
const StudentDashboard = lazy(() => import("./pages/student/Dashboard"));
const StudentSessions = lazy(() => import("./pages/student/Sessions"));
const StudentMakeups = lazy(() => import("./pages/student/Makeups"));
const StudentPayments = lazy(() => import("./pages/student/Payments"));
const StudentAttendance = lazy(() => import("./pages/student/Attendance"));
const StudentProfile = lazy(() => import("./pages/student/Profile"));
const StudentEnroll = lazy(() => import("./pages/student/Enroll"));

// Coach portal
const CoachLayout = lazy(() => import("./pages/coach/CoachLayout"));
const CoachDashboard = lazy(() => import("./pages/coach/Dashboard"));
const CoachSchedule = lazy(() => import("./pages/coach/Schedule"));
const CoachBatches = lazy(() => import("./pages/coach/Batches"));
const CoachHours = lazy(() => import("./pages/coach/Hours"));
const CoachProfile = lazy(() => import("./pages/coach/Profile"));
const CoachSession = lazy(() => import("./pages/coach/SessionAttendance"));

// Admin
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const AdminOverview = lazy(() => import("./pages/admin/Overview"));
const AdminStudents = lazy(() => import("./pages/admin/Students"));
const AdminStudentDetail = lazy(() => import("./pages/admin/StudentDetail"));
const AdminCoaches = lazy(() => import("./pages/admin/Coaches"));
const AdminCoachDetail = lazy(() => import("./pages/admin/CoachDetail"));
const AdminBatches = lazy(() => import("./pages/admin/Batches"));
const AdminBatchDetail = lazy(() => import("./pages/admin/BatchDetail"));
const AdminSessions = lazy(() => import("./pages/admin/Sessions"));
const AdminSessionDetail = lazy(() => import("./pages/admin/SessionDetail"));
const AdminMakeups = lazy(() => import("./pages/admin/Makeups"));
const AdminVenues = lazy(() => import("./pages/admin/Venues"));
const AdminVenueDetail = lazy(() => import("./pages/admin/VenueDetail"));
const AdminPricing = lazy(() => import("./pages/admin/Pricing"));
const AdminFinance = lazy(() => import("./pages/admin/Finance"));
const AdminReports = lazy(() => import("./pages/admin/Reports"));
const AdminSettings = lazy(() => import("./pages/admin/Settings"));
const AdminUsers = lazy(() => import("./pages/admin/Users"));
const AdminAudit = lazy(() => import("./pages/admin/Audit"));
const WebsiteLayout = lazy(() => import("./pages/admin/website/WebsiteLayout"));
const WebsiteHomepage = lazy(() => import("./pages/admin/website/Homepage"));
const WebsitePosts = lazy(() => import("./pages/admin/website/Posts"));
const WebsitePrograms = lazy(() => import("./pages/admin/website/Programs"));
const WebsiteGallery = lazy(() => import("./pages/admin/website/Gallery"));
const WebsiteMedia = lazy(() => import("./pages/admin/website/Media"));
const WebsiteEvents = lazy(() => import("./pages/admin/website/Events"));
const WebsiteTestimonials = lazy(() => import("./pages/admin/website/Testimonials"));
const WebsiteFaqs = lazy(() => import("./pages/admin/website/Faqs"));
const WebsiteAnnouncements = lazy(() => import("./pages/admin/website/Announcements"));
const WebsiteEnquiries = lazy(() => import("./pages/admin/website/Enquiries"));

export default function App() {
  return (
    <Suspense fallback={<div className="container-page"><Loading /></div>}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<Home />} />
          <Route path="about" element={<About />} />
          <Route path="programs" element={<Programs />} />
          <Route path="programs/:slug" element={<ProgramDetail />} />
          <Route path="batches" element={<Batches />} />
          <Route path="batches/:id" element={<BatchDetail />} />
          <Route path="coaches" element={<Coaches />} />
          <Route path="venues" element={<Venues />} />
          <Route path="news" element={<News />} />
          <Route path="news/:slug" element={<NewsDetail />} />
          <Route path="gallery" element={<Gallery />} />
          <Route path="gallery/:slug" element={<AlbumDetail />} />
          <Route path="events" element={<Events />} />
          <Route path="events/:slug" element={<EventDetail />} />
          <Route path="faq" element={<Faq />} />
          <Route path="contact" element={<Contact />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="account" element={<AccountRedirect />} />

        <Route path="student" element={<StudentLayout />}>
          <Route index element={<StudentDashboard />} />
          <Route path="sessions" element={<StudentSessions />} />
          <Route path="makeups" element={<StudentMakeups />} />
          <Route path="payments" element={<StudentPayments />} />
          <Route path="attendance" element={<StudentAttendance />} />
          <Route path="profile" element={<StudentProfile />} />
          <Route path="enroll/:batchId" element={<StudentEnroll />} />
        </Route>

        <Route path="coach" element={<CoachLayout />}>
          <Route index element={<CoachDashboard />} />
          <Route path="schedule" element={<CoachSchedule />} />
          <Route path="batches" element={<CoachBatches />} />
          <Route path="hours" element={<CoachHours />} />
          <Route path="profile" element={<CoachProfile />} />
          <Route path="sessions/:id" element={<CoachSession />} />
        </Route>

        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<AdminOverview />} />
          <Route path="students" element={<AdminStudents />} />
          <Route path="students/:id" element={<AdminStudentDetail />} />
          <Route path="coaches" element={<AdminCoaches />} />
          <Route path="coaches/:id" element={<AdminCoachDetail />} />
          <Route path="batches" element={<AdminBatches />} />
          <Route path="batches/:id" element={<AdminBatchDetail />} />
          <Route path="sessions" element={<AdminSessions />} />
          <Route path="sessions/:id" element={<AdminSessionDetail />} />
          <Route path="makeups" element={<AdminMakeups />} />
          <Route path="venues" element={<AdminVenues />} />
          <Route path="venues/:id" element={<AdminVenueDetail />} />
          <Route path="pricing" element={<AdminPricing />} />
          <Route path="finance" element={<AdminFinance />} />
          <Route path="reports" element={<AdminReports />} />
          <Route path="website" element={<WebsiteLayout />}>
            <Route index element={<WebsiteHomepage />} />
            <Route path="posts" element={<WebsitePosts />} />
            <Route path="programs" element={<WebsitePrograms />} />
            <Route path="gallery" element={<WebsiteGallery />} />
            <Route path="media" element={<WebsiteMedia />} />
            <Route path="events" element={<WebsiteEvents />} />
            <Route path="testimonials" element={<WebsiteTestimonials />} />
            <Route path="faqs" element={<WebsiteFaqs />} />
            <Route path="announcements" element={<WebsiteAnnouncements />} />
            <Route path="enquiries" element={<WebsiteEnquiries />} />
          </Route>
          <Route path="settings" element={<AdminSettings />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="audit" element={<AdminAudit />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
