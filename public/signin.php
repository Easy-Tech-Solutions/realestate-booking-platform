<?php 
session_start();
include("../configurations/config.php");
$error="";
$msg="";
if(isset($_REQUEST['login']))
{
	$email=$_REQUEST['email'];
	$pass=$_REQUEST['pass'];
	$pass= sha1($pass);
	
	if(!empty($email) && !empty($pass))
	{
		$sql = "SELECT * FROM user where email='$email' && pass='$pass'";
		$result=mysqli_query($con, $sql);
		$row=mysqli_fetch_array($result);
		   if($row){
			   
				$_SESSION['uid']=$row['uid'];
				$_SESSION['email']=$email;
				header("location:../index.html");
				
		   }
		   else{
			   $error = "<p class='alert alert-warning'>Email or Password doesnot match!</p> ";
		   }
	}else{
		$error = "<p class='alert alert-warning'>Please Fill all the fields</p>";
	}
}
?>

<!DOCTYPE html>

<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en-US" lang="en-US">

<head>
    <meta charset="utf-8">
    <title>Homelengo - Real Estate HTML Template</title>
    <meta name="keywords" content="HTML, CSS, JavaScript, Bootstrap">
    <meta name="description" content="Real Estate HTML Template">

    <meta name="author" content="themesflat.com">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">

   <!-- font -->
   <link rel="stylesheet" href="../assets/fonts/fonts.css">
   <!-- Icons -->
   <link rel="stylesheet" href="../assets/fonts/font-icons.css">
   <link rel="stylesheet" href="../assets/css/bootstrap.min.css">
   <link rel="stylesheet" href="../assets/css/swiper-bundle.min.css">
   <link rel="stylesheet" href="../assets/css/animate.css">
   <link rel="stylesheet" type="text/css" href="../assets/css/styles.css"/>
   <link rel="stylesheet" type="text/css" href="../assets/css/additional-style.css"/>

    <!-- Favicon and Touch Icons  -->
    <link rel="shortcut icon" href="../assets/images/logo/favicon.png">
    <link rel="apple-touch-icon-precomposed" href="../assets/images/logo/favicon.png">

</head>

<body class="body">

   <!-- RTL -->
   <!-- <a href="javascript:void(0);" id="toggle-rtl" class="tf-btn primary">RTL</a> -->
   <!-- /RTL  --> 

    <!-- preload -->
    <div class="preload preload-container">
        <div class="preload-logo">
            <div class="spinner"></div>
            <span class="icon icon-villa-fill"></span>
        </div>
    </div>
    <!-- /preload -->

    <div id="wrapper">
        <div id="pagee" class="clearfix">

            <!-- Main Header -->
            <?php include("../include/header.php");?>
            <!-- End Main Header -->

            <!--Login -->
            <div class="row gx-5 justify-content-center">
                <div class="flat-account col-lg-8 col-xl-6">

                <?php echo $error; ?><?php echo $msg; ?>
                    <form class="form-account" method="post">
                        <div class="title-box">
                            <h4>Login</h4>
                            <span class="close-modal icon-close2" data-bs-dismiss="modal"></span>
                        </div>
                        <div class="box">
                            <fieldset class="box-fieldset">
                                <label>Username or Email</label>
                                <div class="ip-field">
                                    <svg class="icon" width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M13.4869 14.0435C12.9628 13.3497 12.2848 12.787 11.5063 12.3998C10.7277 12.0126 9.86989 11.8115 9.00038 11.8123C8.13086 11.8115 7.27304 12.0126 6.49449 12.3998C5.71594 12.787 5.03793 13.3497 4.51388 14.0435M13.4869 14.0435C14.5095 13.1339 15.2307 11.9349 15.5563 10.6056C15.8818 9.27625 15.7956 7.87934 15.309 6.60014C14.8224 5.32093 13.9584 4.21986 12.8317 3.44295C11.7049 2.66604 10.3686 2.25 9 2.25C7.63137 2.25 6.29508 2.66604 5.16833 3.44295C4.04158 4.21986 3.17762 5.32093 2.69103 6.60014C2.20443 7.87934 2.11819 9.27625 2.44374 10.6056C2.76929 11.9349 3.49125 13.1339 4.51388 14.0435M13.4869 14.0435C12.2524 15.1447 10.6546 15.7521 9.00038 15.7498C7.3459 15.7523 5.74855 15.1448 4.51388 14.0435M11.2504 7.31228C11.2504 7.90902 11.0133 8.48131 10.5914 8.90327C10.1694 9.32523 9.59711 9.56228 9.00038 9.56228C8.40364 9.56228 7.83134 9.32523 7.40939 8.90327C6.98743 8.48131 6.75038 7.90902 6.75038 7.31228C6.75038 6.71554 6.98743 6.14325 7.40939 5.72129C7.83134 5.29933 8.40364 5.06228 9.00038 5.06228C9.59711 5.06228 10.1694 5.29933 10.5914 5.72129C11.0133 6.14325 11.2504 6.71554 11.2504 7.31228Z" stroke="#A3ABB0" stroke-linecap="round" stroke-linejoin="round"/>
                                    </svg>
                                    <input type="email" name="email" class="form-control" placeholder="Enter your email">   
                                </div>
                            </fieldset>
                            <fieldset class="box-fieldset">
                                <label>Password</label>
                                <div class="ip-field">
                                    <svg class="icon" width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M12.375 7.875V5.0625C12.375 4.16739 12.0194 3.30895 11.3865 2.67601C10.7535 2.04308 9.89511 1.6875 9 1.6875C8.10489 1.6875 7.24645 2.04308 6.61351 2.67601C5.98058 3.30895 5.625 4.16739 5.625 5.0625V7.875M5.0625 16.3125H12.9375C13.3851 16.3125 13.8143 16.1347 14.1307 15.8182C14.4472 15.5018 14.625 15.0726 14.625 14.625V9.5625C14.625 9.11495 14.4472 8.68573 14.1307 8.36926C13.8143 8.05279 13.3851 7.875 12.9375 7.875H5.0625C4.61495 7.875 4.18573 8.05279 3.86926 8.36926C3.55279 8.68573 3.375 9.11495 3.375 9.5625V14.625C3.375 15.0726 3.55279 15.5018 3.86926 15.8182C4.18573 16.1347 4.61495 16.3125 5.0625 16.3125Z" stroke="#A3ABB0" stroke-linecap="round" stroke-linejoin="round"/>
                                    </svg>
                                    <input type="password" name="pass" class="form-control" placeholder="Your password">   
                                </div>
                                <div class="text-forgot text-end"><a href="#">Forgot password</a></div>

                            </fieldset>
                        </div>
                        <div class="box box-btn">
                            <button class="btn tf-btn primary w-100" name="login" value="Login" type="submit">Login</button>
                            <div class="text text-center">Don’t you have an account? <a href="./signup.php" data-bs-toggle="modal" class="text-primary">Register</a></div>
                        </div>
                        <p class="box text-center caption-2">or login with</p>
                        <div class="group-btn">
                            <a href="#" class="btn-social">
                                <img src="../assets/images/logo/google.jpg" alt="img">
                                Google
                            </a>
                            <a href="#" class="btn-social">
                                <img src="../assets/images/logo/apple.png" alt="img" width="50px" height="50px">
                                Apple
                            </a>
                            
                        </div>
                    </form>
            </div>
            </div>
             
            
           
            <!-- footer -->
            <?php include("../include/footer.php");?>
            <!-- end footer -->
            

        </div>
        <!-- /#page -->

    </div>

    <!-- go top -->
    <div class="progress-wrap">
        <svg class="progress-circle svg-content" width="100%" height="100%" viewBox="-1 -1 102 102">
        <path d="M50,1 a49,49 0 0,1 0,98 a49,49 0 0,1 0,-98" style="transition: stroke-dashoffset 10ms linear 0s; stroke-dasharray: 307.919, 307.919; stroke-dashoffset: 286.138;"></path>
        </svg>
    </div>

    <!-- Javascript -->
    <script type="text/javascript" src="../assets/js/bootstrap.min.js"></script>
    <script type="text/javascript" src="../assets/js/jquery.min.js"></script>
    <script type="text/javascript" src="../assets/js/swiper-bundle.min.js"></script>
    <script type="text/javascript" src="../assets/js/carousel.js"></script>
    <script type="text/javascript" src="../assets/js/plugin.js"></script>
    <script type="text/javascript" src="../assets/js/jquery.nice-select.min.js"></script>
    <script type="text/javascript" src="../assets/js/jquery.nice-select.min.js"></script>
    <script type="text/javascript" src="../assets/js/animation_heading.js"></script>
    <script type="text/javascript" src="../assets/js/rangle-slider.js"></script>
    <script type="text/javascript" src="../assets/js/shortcodes.js"></script>
    <script type="text/javascript" src="../assets/js/lazysize.min.js"></script>
    <script type="text/javascript" src="../assets/js/main.js"></script>
  
</body>

</html>